/**
 * Security Demo Example
 * Demonstrates: Validation middleware, rate limiting, auth hooks, secure patterns
 * ADR-002: Uses factory pattern with explicit context
 */

import { z } from 'zod';
import {
  createApp,
  FrameworkError,
} from '@klusterio/kinetic-core';
import {
  defineModel,
  wrapSuccess,
} from '@klusterio/kinetic-core/schema';
import {
  validateBody,
  rateLimit,
  createAuthHook,
  extractBearerToken,
} from '@klusterio/kinetic-core/security';

console.log('🔒 Security Demo Example - Factory Pattern\n');

// ============================================================================
// 1. Token-based Auth System (simulated)
// ============================================================================

function createTokenManager() {
  const tokens = new Map();
  const users = new Map();

  return {
    createToken(userId, expiresIn = 3600) {
      const token = btoa(JSON.stringify({ userId, exp: Date.now() + expiresIn * 1000 }));
      tokens.set(token, { userId, exp: Date.now() + expiresIn * 1000 });
      return token;
    },

    verify(token) {
      try {
        const data = JSON.parse(atob(token));
        const stored = tokens.get(token);
        if (!stored || stored.exp < Date.now()) return null;
        return { userId: data.userId };
      } catch {
        return null;
      }
    },

    addUser(userId, email, role) {
      users.set(userId, { id: userId, email, role });
    },

    getUser(userId) {
      return users.get(userId) || null;
    },

    listUsers() {
      return Array.from(users.values());
    },
  };
}

// ============================================================================
// 2. In-Memory Store with Audit Logging
// ============================================================================

function createAuditedStore(name, logger) {
  const data = new Map();
  const auditLog = [];

  function audit(action, userId, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      resource: name,
      details,
    };
    auditLog.push(entry);
    logger.info('AUDIT', entry);
  }

  return {
    async create(record, userId) {
      const id = crypto.randomUUID();
      const newRecord = { ...record, id, createdAt: new Date() };
      data.set(id, newRecord);
      audit('CREATE', userId, { id, resource: name });
      return newRecord;
    },

    async findAll(userId) {
      audit('READ_ALL', userId, { resource: name });
      return Array.from(data.values());
    },

    async findById(id, userId) {
      audit('READ', userId, { id, resource: name });
      return data.get(id) || null;
    },

    async update(id, updates, userId) {
      const existing = data.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates, updatedAt: new Date() };
      data.set(id, updated);
      audit('UPDATE', userId, { id, resource: name, updates: Object.keys(updates) });
      return updated;
    },

    async delete(id, userId) {
      const existed = data.delete(id);
      if (existed) {
        audit('DELETE', userId, { id, resource: name });
      }
      return existed;
    },

    getAuditLog() {
      return [...auditLog];
    },
  };
}

// ============================================================================
// 3. Models with Security Constraints
// ============================================================================

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['user', 'admin']).default('user'),
    createdAt: z.date(),
  },
});

const SensitiveDataModel = defineModel({
  name: 'SensitiveData',
  fields: {
    id: z.string().uuid(),
    ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/),
    creditCard: z.string().regex(/^\d{16}$/),
    data: z.string(),
    ownerId: z.string(),
    createdAt: z.date(),
  },
});

// ============================================================================
// 4. Factory Functions for Services
// ============================================================================

function createLogger() {
  return {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data ? JSON.stringify(data) : ''),
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  };
}

// ============================================================================
// 5. Application Setup with Factory Pattern
// ============================================================================

console.log('Setting up security demo with factory pattern...\n');

const config = {
  port: 3002,
  host: '127.0.0.1',
};

const app = await createApp({
  createAppContext: async () => {
    const logger = createLogger();

    const tokenManager = createTokenManager();

    const userStore = createAuditedStore('User', logger);
    const sensitiveStore = createAuditedStore('SensitiveData', logger);

    // Create auth hook using security module
    const authHook = createAuthHook(async (request) => {
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

    return {
      logger,
      tokenManager,
      userStore,
      sensitiveStore,
      authHook,
    };
  },
});

console.log('✅ Application created with factory pattern\n');

// Seed data with tokens
const { tokenManager, userStore, sensitiveStore } = app.context;
const adminId = 'admin-' + crypto.randomUUID().slice(9);
const userId = 'user-' + crypto.randomUUID().slice(9);

tokenManager.addUser(adminId, 'admin@example.com', 'admin');
tokenManager.addUser(userId, 'user@example.com', 'user');

const adminToken = tokenManager.createToken(adminId);
const userToken = tokenManager.createToken(userId);

console.log('🔐 Test Tokens:');
console.log(`   Admin: ${adminToken.slice(0, 20)}...`);
console.log(`   User:  ${userToken.slice(0, 20)}...\n`);

// ============================================================================
// 6. Routes with Security Features
// ============================================================================

// Helper middleware
const requireAuth = async (request, reply) => {
  const authHeader = request.headers?.authorization || '';
  const token = extractBearerToken({ authorization: authHeader });

  if (!token) {
    throw new FrameworkError({
      code: 'VALIDATION_ERROR',
      message: 'Authorization token required',
      suggestion: 'Include "Authorization: Bearer <token>" header',
    });
  }

  const verified = tokenManager.verify(token);
  if (!verified) {
    throw new FrameworkError({
      code: 'VALIDATION_ERROR',
      message: 'Invalid or expired token',
    });
  }

  const user = tokenManager.getUser(verified.userId);
  if (!user) {
    throw new FrameworkError({
      code: 'VALIDATION_ERROR',
      message: 'User not found',
    });
  }

  request.user = user;
};

const requireAdmin = async (request, reply) => {
  await requireAuth(request, reply);
  if (request.user.role !== 'admin') {
    throw new FrameworkError({
      code: 'VALIDATION_ERROR',
      message: 'Admin access required',
    });
  }
};

// Auth hook demo endpoint
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
      rateLimit({ max: 5, window: 300 }),
    ],
    handler: async (request) => {
      const { email, password } = request.body;

      if (email !== 'admin@example.com' && email !== 'user@example.com') {
        throw new FrameworkError({
          code: 'VALIDATION_ERROR',
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
      rateLimit({ max: 100, window: 60 }),
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
        throw new FrameworkError({ code: 'VALIDATION_ERROR', message: 'Not found' });
      }
      if (data.ownerId !== request.user.id && request.user.role !== 'admin') {
        throw new FrameworkError({ code: 'VALIDATION_ERROR', message: 'Access denied' });
      }
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

// Register routes
for (const route of routes) {
  app.route(route);
}

// ============================================================================
// 7. Start Server
// ============================================================================

await app.ready();
await app.listen({ port: config.port, host: config.host });

console.log('✅ Security Demo Server running!\n');
console.log('📡 API Endpoints:');
console.log(`   GET  http://${config.host}:${config.port}/health`);
console.log(`   POST http://${config.host}:${config.port}/login (rate limited: 5/5min)`);
console.log(`   GET  http://${config.host}:${config.port}/public-data (rate limited: 100/min)`);
console.log(`   POST http://${config.host}:${config.port}/users (auth + validation required)`);
console.log(`   GET  http://${config.host}:${config.port}/audit-log (admin only)`);
console.log(`   POST http://${config.host}:${config.port}/sensitive-data (strict validation)`);
console.log(`   POST http://${config.host}:${config.port}/admin/reset-cache (admin only)`);

export { app, tokenManager, userStore };
