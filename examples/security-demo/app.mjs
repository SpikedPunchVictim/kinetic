/**
 * Security Demo Example
 * Demonstrates: Validation middleware, rate limiting, auth hooks, secure patterns
 */

import { z } from 'zod';
import {
  createApp,
  createContainer,
  FrameworkError,
  ErrorCodes,
} from '@klusterio/kinetic-core';
import {
  defineModel,
  wrapSuccess,
  enforcePagination,
} from '@klusterio/kinetic-core/schema';
import {
  validateBody,
  rateLimit,
  createAuthHook,
  extractBearerToken,
} from '@klusterio/kinetic-core/security';

console.log('🔒 Security Demo Example\n');

// ============================================================================
// 1. Token-based Auth System (simulated)
// ============================================================================

class TokenManager {
  constructor() {
    this.tokens = new Map();
    this.users = new Map();
  }

  createToken(userId, expiresIn = 3600) {
    const token = btoa(JSON.stringify({ userId, exp: Date.now() + expiresIn * 1000 }));
    this.tokens.set(token, { userId, exp: Date.now() + expiresIn * 1000 });
    return token;
  }

  verify(token) {
    try {
      const data = JSON.parse(atob(token));
      const stored = this.tokens.get(token);
      if (!stored || stored.exp < Date.now()) return null;
      return { userId: data.userId };
    } catch {
      return null;
    }
  }

  addUser(userId, email, role) {
    this.users.set(userId, { id: userId, email, role });
  }

  getUser(userId) {
    return this.users.get(userId) || null;
  }
}

// ============================================================================
// 2. In-Memory Store with Audit Logging
// ============================================================================

class AuditedStore {
  constructor(name, logger) {
    this.name = name;
    this.data = new Map();
    this.auditLog = [];
    this.logger = logger;
  }

  audit(action, userId, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      resource: this.name,
      details,
    };
    this.auditLog.push(entry);
    this.logger.info('AUDIT', entry);
  }

  async create(record, userId) {
    const id = crypto.randomUUID();
    const newRecord = { ...record, id, createdAt: new Date() };
    this.data.set(id, newRecord);
    this.audit('CREATE', userId, { id, resource: this.name });
    return newRecord;
  }

  async findAll(userId) {
    this.audit('READ_ALL', userId, { resource: this.name });
    return Array.from(this.data.values());
  }

  async findById(id, userId) {
    this.audit('READ', userId, { id, resource: this.name });
    return this.data.get(id) || null;
  }

  async update(id, updates, userId) {
    const existing = this.data.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date() };
    this.data.set(id, updated);
    this.audit('UPDATE', userId, { id, resource: this.name, updates: Object.keys(updates) });
    return updated;
  }

  async delete(id, userId) {
    const existed = this.data.delete(id);
    if (existed) {
      this.audit('DELETE', userId, { id, resource: this.name });
    }
    return existed;
  }

  getAuditLog() {
    return [...this.auditLog];
  }
}

// ============================================================================
// 3. Models with Security Constraints
// ============================================================================

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    password: z.string().min(8), // Min length validation
    role: z.enum(['user', 'admin']).default('user'),
    createdAt: z.date(),
  },
});

const SensitiveDataModel = defineModel({
  name: 'SensitiveData',
  fields: {
    id: z.string().uuid(),
    ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/), // Format validation
    creditCard: z.string().regex(/^\d{16}$/),
    data: z.string(),
    ownerId: z.string(),
    createdAt: z.date(),
  },
});

// ============================================================================
// 4. Container with Security Services
// ============================================================================

const container = createContainer({
  logger: async () => ({
    info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  }),

  tokenManager: async () => new TokenManager(),

  userStore: async ({ logger }) => new AuditedStore('User', logger),
  sensitiveStore: async ({ logger }) => new AuditedStore('SensitiveData', logger),

  authHook: async ({ tokenManager, userStore }) => {
    return createAuthHook(async (request) => {
      const token = extractBearerToken(request.headers || {});
      if (!token) {
        return { success: false, error: 'No token provided' };
      }

      const verified = tokenManager.verify(token);
      if (!verified) {
        return { success: false, error: 'Invalid or expired token' };
      }

      const user = tokenManager.getUser(verified.userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      return { success: true, user };
    });
  },
});

// Validate
const validation = container.validate();
if (!validation.success) {
  console.error('❌ Container validation failed:', validation.errors);
  process.exit(1);
}

console.log('✅ Container validated');

// ============================================================================
// 5. Create Application
// ============================================================================

const app = await createApp({
  container,
  config: {
    port: 3002,
    host: '127.0.0.1',
    env: 'development',
  },
});

await container.initialize();
const tokenManager = container.get('tokenManager');
const userStore = container.get('userStore');
const sensitiveStore = container.get('sensitiveStore');

// Seed data with tokens
const adminId = 'admin-' + crypto.randomUUID().slice(9);
const userId = 'user-' + crypto.randomUUID().slice(9);
tokenManager.addUser(adminId, 'admin@example.com', 'admin');
tokenManager.addUser(userId, 'user@example.com', 'user');

const adminToken = tokenManager.createToken(adminId);
const userToken = tokenManager.createToken(userId);

console.log('\n🔐 Test Tokens:');
console.log(`   Admin: ${adminToken.slice(0, 20)}...`);
console.log(`   User:  ${userToken.slice(0, 20)}...`);

// ============================================================================
// 6. Routes with Security Features
// ============================================================================

// Authentication middleware
const requireAuth = async (request, reply) => {
  const authHeader = request.headers?.authorization || '';
  const token = extractBearerToken({ authorization: authHeader });

  if (!token) {
    throw new FrameworkError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Authorization token required',
      suggestion: 'Include "Authorization: Bearer <token>" header',
    });
  }

  const verified = tokenManager.verify(token);
  if (!verified) {
    throw new FrameworkError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Invalid or expired token',
    });
  }

  const user = tokenManager.getUser(verified.userId);
  if (!user) {
    throw new FrameworkError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'User not found',
    });
  }

  request.user = user;
};

const requireAdmin = async (request, reply) => {
  await requireAuth(request, reply);
  if (request.user.role !== 'admin') {
    throw new FrameworkError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Admin access required',
    });
  }
};

const routes = [
  // Health (public)
  {
    method: 'GET',
    path: '/health',
    handler: async () => wrapSuccess({ status: 'healthy' }),
  },

  // Login (public, rate limited)
  {
    method: 'POST',
    path: '/login',
    preHandler: [
      rateLimit({ max: 5, window: 300 }), // 5 attempts per 5 minutes
    ],
    handler: async (request) => {
      const { email, password } = request.body;

      // In real app, verify password hash
      if (email !== 'admin@example.com' && email !== 'user@example.com') {
        throw new FrameworkError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid credentials',
        });
      }

      const user = email === 'admin@example.com'
        ? { id: adminId, email, role: 'admin' }
        : { id: userId, email, role: 'user' };

      const token = tokenManager.createToken(user.id);

      return wrapSuccess({ token, user: { id: user.id, email: user.email, role: user.role } });
    },
  },

  // Public data (rate limited for reads)
  {
    method: 'GET',
    path: '/public-data',
    preHandler: [
      rateLimit({ max: 100, window: 60 }), // 100 requests per minute
    ],
    handler: async () => wrapSuccess({ message: 'Public data' }),
  },

  // Create user (validation + auth)
  {
    method: 'POST',
    path: '/users',
    preHandler: [
      validateBody(UserModel.inputSchema),
      requireAuth,
    ],
    handler: async (request) => {
      const user = await userStore.create(request.body, request.user.id);
      return wrapSuccess(user);
    },
  },

  // List users (auth required)
  {
    method: 'GET',
    path: '/users',
    preHandler: [requireAuth],
    handler: async (request) => {
      const users = await userStore.findAll(request.user.id);
      // Don't expose passwords
      const safeUsers = users.map(({ password, ...user }) => user);
      return wrapSuccess(safeUsers);
    },
  },

  // Get audit log (admin only)
  {
    method: 'GET',
    path: '/audit-log',
    preHandler: [requireAdmin],
    handler: async () => {
      const log = userStore.getAuditLog();
      return wrapSuccess(log);
    },
  },

  // Create sensitive data (strict validation + auth)
  {
    method: 'POST',
    path: '/sensitive-data',
    preHandler: [
      validateBody(SensitiveDataModel.inputSchema),
      requireAuth,
    ],
    handler: async (request) => {
      const data = await sensitiveStore.create(
        { ...request.body, ownerId: request.user.id },
        request.user.id
      );
      // Mask sensitive fields in response
      const safeData = { ...data, ssn: '***-**-' + data.ssn.slice(-4) };
      return wrapSuccess(safeData);
    },
  },

  // Get sensitive data (ownership check)
  {
    method: 'GET',
    path: '/sensitive-data/:id',
    preHandler: [requireAuth],
    handler: async (request) => {
      const data = await sensitiveStore.findById(request.params.id, request.user.id);
      if (!data) {
        throw new FrameworkError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Not found' });
      }
      // Users can only access their own data (or admins)
      if (data.ownerId !== request.user.id && request.user.role !== 'admin') {
        throw new FrameworkError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Access denied' });
      }
      // Mask in response
      const safeData = { ...data, ssn: '***-**-' + data.ssn.slice(-4), creditCard: '****' + data.creditCard.slice(-4) };
      return wrapSuccess(safeData);
    },
  },

  // Admin only endpoint (admin role check)
  {
    method: 'POST',
    path: '/admin/reset-cache',
    preHandler: [requireAdmin],
    handler: async (request) => {
      console.log('Cache reset by admin:', request.user.email);
      return wrapSuccess({ reset: true, by: request.user.id });
    },
  },
];

app.registerRoutes(routes);

// ============================================================================
// 6. Start Server
// ============================================================================

await app.start();

console.log('\n✅ Security Demo Server running!');
console.log(`\n📡 API Endpoints:`);
console.log(`   GET  http://127.0.0.1:3002/health`);
console.log(`   POST http://127.0.0.1:3002/login (rate limited: 5/5min)`);
console.log(`   GET  http://127.0.0.1:3002/public-data (rate limited: 100/min)`);
console.log(`   POST http://127.0.0.1:3002/users (auth + validation required)`);
console.log(`   GET  http://127.0.0.1:3002/audit-log (admin only)`);
console.log(`   POST http://127.0.0.1:3002/sensitive-data (strict validation)`);
console.log(`   POST http://127.0.0.1:3002/admin/reset-cache (admin only)`);

export { app, container, tokenManager, userStore };
