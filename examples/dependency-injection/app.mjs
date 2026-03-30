/**
 * Dependency Injection Example
 * Demonstrates: Advanced DI container with multiple layers, circular dependency detection
 */

import { z } from 'zod';
import {
  createApp,
  createContainer,
  FrameworkError,
  ErrorCodes,
} from '@klusterio/kinetic-core';
import { defineModel, wrapSuccess } from '@klusterio/kinetic-core/schema';
import { validateBody } from '@klusterio/kinetic-core/security';

console.log('🔧 Dependency Injection Example\n');

// ============================================================================
// 1. Infrastructure Layer
// ============================================================================

class Database {
  constructor({ host, port, name }) {
    this.host = host;
    this.port = port;
    this.database = name;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    console.log(`🔌 Database connected: ${this.host}:${this.port}/${this.database}`);
    return this;
  }

  async query(sql) {
    if (!this.connected) throw new Error('Database not connected');
    console.log(`📊 Query: ${sql}`);
    return [];
  }
}

class Cache {
  constructor() {
    this.data = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const value = this.data.get(key);
    if (value) {
      this.hits++;
      return value;
    }
    this.misses++;
    return null;
  }

  set(key, value, ttl = 3600) {
    this.data.set(key, { value, expires: Date.now() + ttl * 1000 });
  }

  getStats() {
    return { hits: this.hits, misses: this.misses, size: this.data.size };
  }
}

class Logger {
  constructor({ format = 'json', level = 'info' } = {}) {
    this.format = format;
    this.level = level;
    this.logs = [];
  }

  log(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    this.logs.push(entry);
    console.log(`[${level.toUpperCase()}] ${message}`, meta);
  }

  info(msg, meta) { this.log('info', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
  debug(msg, meta) { this.log('debug', msg, meta); }

  getRecent(count = 10) {
    return this.logs.slice(-count);
  }
}

class MetricsCollector {
  constructor({ logger }) {
    this.logger = logger;
    this.metrics = new Map();
  }

  increment(name, tags = {}) {
    const key = `${name}:${JSON.stringify(tags)}`;
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + 1);
  }

  timing(name, duration, tags = {}) {
    this.logger.debug('Metric timing', { name, duration, tags });
  }

  gauge(name, value, tags = {}) {
    this.logger.debug('Metric gauge', { name, value, tags });
  }

  getReport() {
    const report = {};
    for (const [key, value] of this.metrics) {
      report[key] = value;
    }
    return report;
  }
}

// ============================================================================
// 2. Repository Layer
// ============================================================================

class Repository {
  constructor({ db, cache, logger }) {
    this.db = db;
    this.cache = cache;
    this.logger = logger;
  }

  async findById(table, id) {
    const cacheKey = `${table}:${id}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug('Cache hit', { table, id });
      return cached.value;
    }

    this.logger.debug('Cache miss', { table, id });
    const result = await this.db.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (result[0]) {
      this.cache.set(cacheKey, result[0]);
    }
    return result[0] || null;
  }

  async findAll(table) {
    return this.db.query(`SELECT * FROM ${table}`);
  }
}

// ============================================================================
// 3. Service Layer
// ============================================================================

class UserService {
  constructor({ repository, cache, logger, metrics }) {
    this.repository = repository;
    this.cache = cache;
    this.logger = logger;
    this.metrics = metrics;
  }

  async findById(id) {
    this.metrics.increment('user.find', { by: 'id' });
    return this.repository.findById('users', id);
  }

  async authenticate(email, password) {
    this.logger.info('Authenticating user', { email });
    this.metrics.increment('auth.attempt');
    // Authentication logic here
    return { id: '1', email, role: 'user' };
  }

  async getStats() {
    return {
      cacheStats: this.cache.getStats(),
    };
  }
}

class OrderService {
  constructor({ repository, userService, cache, logger, metrics }) {
    this.repository = repository;
    this.userService = userService;
    this.cache = cache;
    this.logger = logger;
    this.metrics = metrics;
  }

  async createOrder(userId, items) {
    this.logger.info('Creating order', { userId, itemCount: items.length });
    this.metrics.increment('order.create');

    const user = await this.userService.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const order = {
      id: crypto.randomUUID(),
      userId,
      items,
      total: items.reduce((sum, item) => sum + item.price, 0),
      createdAt: new Date(),
    };

    return order;
  }

  async getOrderHistory(userId) {
    this.logger.info('Getting order history', { userId });
    return [];
  }
}

class NotificationService {
  constructor({ logger, metrics }) {
    this.logger = logger;
    this.metrics = metrics;
  }

  async sendEmail(to, subject, body) {
    this.logger.info('Sending email', { to, subject });
    this.metrics.increment('notification.email');
    return { sent: true };
  }

  async sendNotification(userId, message) {
    this.logger.info('Sending notification', { userId, message });
    this.metrics.increment('notification.push');
    return { sent: true };
  }
}

// ============================================================================
// 4. Container Setup
// ============================================================================

const container = createContainer({
  // Infrastructure services (no dependencies)
  dbConfig: async () => ({
    host: 'localhost',
    port: 5432,
    name: 'myapp',
  }),

  db: async ({ dbConfig, logger }) => {
    logger.info('Initializing database connection...');
    const db = new Database(dbConfig);
    await db.connect();
    return db;
  },

  cache: async ({ logger }) => {
    logger.info('Initializing cache...');
    return new Cache();
  },

  logger: async () => {
    const logger = new Logger({ format: 'json', level: 'debug' });
    logger.info('Logger initialized');
    return logger;
  },

  metrics: async ({ logger }) => {
    logger.info('Initializing metrics...');
    return new MetricsCollector({ logger });
  },

  // Repository layer (depends on infrastructure)
  repository: async ({ db, cache, logger }) => {
    logger.info('Initializing repository...');
    return new Repository({ db, cache, logger });
  },

  // Service layer (depends on repositories and infrastructure)
  userService: async ({ repository, cache, logger, metrics }) => {
    logger.info('Initializing user service...');
    return new UserService({ repository, cache, logger, metrics });
  },

  orderService: async ({ repository, userService, cache, logger, metrics }) => {
    logger.info('Initializing order service...');
    return new OrderService({ repository, userService, cache, logger, metrics });
  },

  notificationService: async ({ logger, metrics }) => {
    logger.info('Initializing notification service...');
    return new NotificationService({ logger, metrics });
  },
});

// Validate container
console.log('🔍 Validating container...');
const validation = container.validate();
if (!validation.success) {
  console.error('❌ Container validation failed:', validation.errors);
  process.exit(1);
}

console.log('✅ Container validated');
console.log('   Initialization order:', validation.resolvedOrder.join(' → '));

// ============================================================================
// 5. Create Application
// ============================================================================

const app = await createApp({
  container,
  config: {
    port: 3001, // Different port
    host: '127.0.0.1',
    env: 'development',
  },
});

await container.initialize();
const userService = container.get('userService');
const orderService = container.get('orderService');
const notificationService = container.get('notificationService');
const metrics = container.get('metrics');

// ============================================================================
// 6. Routes
// ============================================================================

const routes = [
  // Health check
  {
    method: 'GET',
    path: '/health',
    handler: async () => wrapSuccess({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    }),
  },

  // Container introspection
  {
    method: 'GET',
    path: '/introspect',
    handler: async () => {
      const info = container.introspect();
      return wrapSuccess(info);
    },
  },

  // User routes
  {
    method: 'GET',
    path: '/users/:id',
    handler: async (request) => {
      const user = await userService.findById(request.params.id);
      if (!user) {
        throw new FrameworkError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'User not found',
        });
      }
      return wrapSuccess(user);
    },
  },

  // Order creation
  {
    method: 'POST',
    path: '/orders',
    handler: async (request) => {
      const { userId, items } = request.body;
      const order = await orderService.createOrder(userId, items);
      await notificationService.sendNotification(userId, 'Order created!');
      return wrapSuccess(order);
    },
  },

  // Get metrics
  {
    method: 'GET',
    path: '/metrics',
    handler: async () => wrapSuccess(metrics.getReport()),
  },

  // Get cache stats
  {
    method: 'GET',
    path: '/cache/stats',
    handler: async () => wrapSuccess(await userService.getStats()),
  },
];

app.registerRoutes(routes);

console.log('📡 Routes registered:', routes.length);

// ============================================================================
// 7. Start Server
// ============================================================================

await app.start();

console.log('\n✅ DI Example Server running!');
console.log(`\n📡 API Endpoints:`);
console.log(`   GET  http://127.0.0.1:3001/health`);
console.log(`   GET  http://127.0.0.1:3001/introspect`);
console.log(`   GET  http://127.0.0.1:3001/users/:id`);
console.log(`   POST http://127.0.0.1:3001/orders`);
console.log(`   GET  http://127.0.0.1:3001/metrics`);
console.log(`   GET  http://127.0.0.1:3001/cache/stats`);

export { app, container, userService, orderService };
