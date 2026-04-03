/**
 * Dependency Injection Example
 * Demonstrates: Factory pattern with explicit dependencies (ADR-002)
 * Shows layered architecture with clear dependency chains
 */

import { z } from 'zod';
import {
  createApp,
  FrameworkError,
} from '@klusterio/kinetic-core';
import { defineModel, wrapSuccess } from '@klusterio/kinetic-core/schema';
import { validateBody } from '@klusterio/kinetic-core/security';

console.log('🔧 Dependency Injection Example - Factory Pattern\n');

// ============================================================================
// 1. Infrastructure Layer - Factory Functions
// ============================================================================

// Infrastructure - Logger
class Logger {
  constructor(options = {}) {
    this.format = options.format || 'json';
    this.level = options.level || 'info';
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

    if (this.format === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`, meta);
    }
  }

  info(msg, meta) { this.log('info', msg, meta); }
  warn(msg, meta) { this.log('warn', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
  debug(msg, meta) { this.log('debug', msg, meta); }
  trace(msg, meta) { this.log('trace', msg, meta); }
  getRecent(count = 10) { return this.logs.slice(-count); }
}

// Infrastructure - InMemoryDatabase
class InMemoryDatabase {
  constructor(config, logger) {
    this.host = config.host;
    this.port = config.port;
    this.database = config.name;
    this.logger = logger;
    this.connected = false;
    this.tables = new Map();
  }

  async connect() {
    this.connected = true;
    this.logger.info('Database connected', { host: this.host, port: this.port });
    return this;
  }

  query(sql) {
    if (!this.connected) throw new Error('Database not connected');
    this.logger.debug('Database query', { sql });
    return [];
  }

  findById(table, id) {
    this.logger.debug('Database findById', { table, id });
    return { id, table, data: 'mock' };
  }

  findAll(table) {
    this.logger.debug('Database findAll', { table });
    return [];
  }

  insert(table, record) {
    this.logger.info('Database insert', { table, id: record.id });
    return record;
  }

  update(table, id, record) {
    this.logger.debug('Database update', { table, id });
    return record;
  }

  delete(table, id) {
    this.logger.debug('Database delete', { table, id });
    return true;
  }
}

// Infrastructure - Cache
class InMemoryCache {
  constructor() {
    this.data = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const value = this.data.get(key);
    if (value && value.expires > Date.now()) {
      this.hits++;
      return value.value;
    }
    this.misses++;
    return null;
  }

  set(key, value, ttl = 3600) {
    this.data.set(key, { value, expires: Date.now() + ttl * 1000 });
  }

  delete(key) {
    return this.data.delete(key);
  }

  getStats() {
    return { hits: this.hits, misses: this.misses, size: this.data.size };
  }

  clear() {
    this.data.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

function createLogger(options = {}) {
  const { format = 'json', level = 'info' } = options;
  const logs = [];
  const levels = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
  const minLevel = levels[level] || 30;

  function shouldLog(logLevel) {
    return levels[logLevel] >= minLevel;
  }

  function log(logLevel, message, meta = {}) {
    if (!shouldLog(logLevel)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
      ...meta,
    };
    logs.push(entry);

    if (format === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      console.log(`[${logLevel.toUpperCase()}] ${message}`, meta);
    }
  }

  return {
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
    trace: (msg, meta) => log('trace', msg, meta),
    getRecent: (count = 10) => logs.slice(-count),
  };
}

function createMetricsCollector(logger) {
  const metrics = new Map();

  return {
    increment(name, tags = {}) {
      const key = `${name}:${JSON.stringify(tags)}`;
      const current = metrics.get(key) || 0;
      metrics.set(key, current + 1);
    },

    timing(name, duration, tags = {}) {
      logger.debug('Metric timing', { name, duration, tags });
    },

    gauge(name, value, tags = {}) {
      logger.debug('Metric gauge', { name, value, tags });
    },

    getReport() {
      const report = {};
      for (const [key, value] of metrics) {
        report[key] = value;
      }
      return report;
    },

    clear() {
      metrics.clear();
    },
  };
}

// ============================================================================
// 2. Repository Layer - Factory Functions
// ============================================================================

function createRepository(db, cache, logger) {
  return {
    async findById(table, id) {
      const cacheKey = `${table}:${id}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        logger.debug('Cache hit', { table, id });
        return cached;
      }

      logger.debug('Cache miss', { table, id });
      const result = await db.findById(table, id);
      if (result) {
        cache.set(cacheKey, result);
      }
      return result;
    },

    async findAll(table) {
      return db.findAll(table);
    },

    async create(table, data) {
      const record = { ...data, id: data.id || crypto.randomUUID() };
      return db.insert(table, record);
    },

    async update(table, id, data) {
      const result = await db.update(table, id, data);
      cache.delete(`${table}:${id}`);
      return result;
    },

    async delete(table, id) {
      cache.delete(`${table}:${id}`);
      return db.delete(table, id);
    },
  };
}

// ============================================================================
// 3. Service Layer - Factory Functions
// ============================================================================

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1).max(100),
    role: z.enum(['user', 'admin']).default('user'),
    createdAt: z.date(),
  },
});

function createUserService(repository, cache, logger, metrics) {
  return {
    async findById(id) {
      metrics.increment('user.find', { by: 'id' });
      return repository.findById('users', id);
    },

    async findAll() {
      metrics.increment('user.find', { by: 'all' });
      return repository.findAll('users');
    },

    async create(data) {
      logger.info('Creating user', { email: data.email });
      metrics.increment('user.create');
      return repository.create('users', data);
    },

    async authenticate(email, password) {
      logger.info('Authenticating user', { email });
      metrics.increment('auth.attempt');
      // Mock authentication
      return { id: crypto.randomUUID(), email, role: 'user' };
    },

    async getStats() {
      return {
        cacheStats: cache.getStats(),
      };
    },
  };
}

function createOrderService(repository, userService, cache, logger, metrics) {
  return {
    async createOrder(userId, items) {
      logger.info('Creating order', { userId, itemCount: items.length });
      metrics.increment('order.create');

      const user = await userService.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const order = {
        id: crypto.randomUUID(),
        userId,
        items,
        total: items.reduce((sum, item) => sum + (item.price || 0), 0),
        createdAt: new Date(),
      };

      return order;
    },

    async getOrderHistory(userId) {
      logger.info('Getting order history', { userId });
      return [];
    },

    async findById(id) {
      metrics.increment('order.find');
      return repository.findById('orders', id);
    },
  };
}

function createNotificationService(logger, metrics) {
  return {
    async sendEmail(to, subject, body) {
      logger.info('Sending email', { to, subject });
      metrics.increment('notification.email');
      return { sent: true, to, subject };
    },

    async sendNotification(userId, message) {
      logger.info('Sending notification', { userId, message });
      metrics.increment('notification.push');
      return { sent: true, userId };
    },
  };
}

// ============================================================================
// 4. Application Setup with Factory Pattern (ADR-002)
// ============================================================================

console.log('Setting up application with factory pattern...\n');

// Configuration
const config = {
  db: { host: 'localhost', port: 5432, name: 'myapp' },
  port: 3001,
  host: '127.0.0.1',
};

// Create app with explicit context factory
const app = await createApp({
  createAppContext: async () => {
    // Initialize in explicit order - no magic dependency injection
    const logger = createLogger({ format: 'pretty', level: 'info' });
    logger.info('Initializing application context...');

    const db = createDatabase(config.db, logger);
    await db.connect();

    const cache = createCache();
    logger.info('Cache initialized');

    const metrics = createMetricsCollector(logger);
    logger.info('Metrics collector initialized');

    const repository = createRepository(db, cache, logger);
    logger.info('Repository initialized');

    const userService = createUserService(repository, cache, logger, metrics);
    logger.info('User service initialized');

    const orderService = createOrderService(repository, userService, cache, logger, metrics);
    logger.info('Order service initialized');

    const notificationService = createNotificationService(logger, metrics);
    logger.info('Notification service initialized');

    return {
      config,
      logger,
      db,
      cache,
      metrics,
      repository,
      userService,
      orderService,
      notificationService,
    };
  },
});

console.log('✅ Application created with factory pattern');
console.log('   - Fastify server: ready\n');

// ============================================================================
// 5. Routes using Context
// ============================================================================

const { userService, orderService, notificationService, metrics } = app.context;

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

  // User routes
  {
    method: 'GET',
    path: '/users/:id',
    handler: async (request) => {
      const user = await userService.findById(request.params.id);
      if (!user) {
        throw new FrameworkError({
          code: 'VALIDATION_ERROR',
          message: 'User not found',
        });
      }
      return wrapSuccess(user);
    },
  },

  {
    method: 'GET',
    path: '/users',
    handler: async () => {
      const users = await userService.findAll();
      return wrapSuccess(users);
    },
  },

  {
    method: 'POST',
    path: '/users',
    preHandler: [validateBody(UserModel.inputSchema)],
    handler: async (request) => {
      const user = await userService.create(request.body);
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

// Register routes directly
for (const route of routes) {
  app.route(route);
}

console.log(`📡 Routes registered: ${routes.length}`);

// ============================================================================
// 6. Start Server
// ============================================================================

await app.ready();
await app.listen({ port: config.port, host: config.host });

console.log('\n✅ DI Example Server running!');
console.log(`\n📡 API Endpoints:`);
console.log(`   GET  http://${config.host}:${config.port}/health`);
console.log(`   GET  http://${config.host}:${config.port}/users/:id`);
console.log(`   GET  http://${config.host}:${config.port}/users`);
console.log(`   POST http://${config.host}:${config.port}/users`);
console.log(`   POST http://${config.host}:${config.port}/orders`);
console.log(`   GET  http://${config.host}:${config.port}/metrics`);
console.log(`   GET  http://${config.host}:${config.port}/cache/stats`);

export { app, userService, orderService };
