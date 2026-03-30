/**
 * First Pass Application - Comprehensive Framework Test
 * Uses every feature of @klusterio/kinetic-core
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
  generateUrlPath,
  wrapSuccess,
  wrapList,
  enforcePagination,
} from '@klusterio/kinetic-core/schema';
import {
  validateBody,
  rateLimit,
} from '@klusterio/kinetic-core/security';

// ============================================================================
// 1. Define Models (Schema Module)
// ============================================================================

console.log('📦 Phase 1: Defining Models...');

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    age: z.number().int().min(0).max(150).optional(),
    isActive: z.boolean().default(true),
    createdAt: z.date().default(() => new Date()),
    updatedAt: z.date().optional(),
  },
  relations: {
    posts: { type: 'hasMany', to: 'Post' },
  },
});

const PostModel = defineModel({
  name: 'Post',
  fields: {
    id: z.string().uuid(),
    title: z.string().min(1).max(255),
    content: z.string(),
    published: z.boolean().default(false),
    authorId: z.string(),
    createdAt: z.date().default(() => new Date()),
  },
  relations: {
    author: { type: 'belongsTo', to: 'User', foreignKey: 'authorId' },
  },
});

console.log('✅ Models defined:');
console.log(`   - User: ${UserModel.getFields().length} fields`);
console.log(`   - Post: ${PostModel.getFields().length} fields`);
console.log(`   - Generated URL for User: ${generateUrlPath('User')}`);
console.log(`   - Generated URL for Post: ${generateUrlPath('Post')}`);

// ============================================================================
// 2. Create DI Container (Container Module)
// ============================================================================

console.log('\n🔧 Phase 2: Creating DI Container...');

const container = createContainer({
  // Infrastructure services (no dependencies)
  logger: async () => ({
    info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
  }),

  // Config service
  config: async () => ({
    appName: 'First Pass App',
    version: '1.0.0',
    env: process.env.NODE_ENV || 'development',
    port: 3001,
  }),

  // Mock database (depends on logger)
  db: async ({ logger }) => {
    logger.info('Initializing database...');
    const users = new Map();
    const posts = new Map();

    return {
      users,
      posts,
      query: (table) => {
        const data = table === 'users' ? users : posts;
        return Array.from(data.values());
      },
      insert: (table, record) => {
        const data = table === 'users' ? users : posts;
        data.set(record.id, record);
        return record;
      },
      findById: (table, id) => {
        const data = table === 'users' ? users : posts;
        return data.get(id) || null;
      },
      update: (table, id, record) => {
        const data = table === 'users' ? users : posts;
        if (!data.has(id)) return null;
        const existing = data.get(id);
        const updated = { ...existing, ...record, updatedAt: new Date() };
        data.set(id, updated);
        return updated;
      },
      delete: (table, id) => {
        const data = table === 'users' ? users : posts;
        return data.delete(id);
      },
    };
  },

  // User store (depends on db and logger)
  userStore: async ({ db, logger }) => ({
    async create(data) {
      logger.info('Creating user', { email: data.email });
      const user = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date(),
      };
      return db.insert('users', user);
    },
    async findById(id) {
      return db.findById('users', id);
    },
    async findAll() {
      return db.query('users');
    },
    async update(id, data) {
      return db.update('users', id, data);
    },
    async delete(id) {
      return db.delete('users', id);
    },
  }),

  // Post store (depends on db, logger)
  postStore: async ({ db, logger }) => ({
    async create(data) {
      logger.info('Creating post', { title: data.title });
      const post = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date(),
      };
      return db.insert('posts', post);
    },
    async findById(id) {
      return db.findById('posts', id);
    },
    async findByAuthor(authorId) {
      return db.query('posts').filter(p => p.authorId === authorId);
    },
    async findAll() {
      return db.query('posts');
    },
    async update(id, data) {
      return db.update('posts', id, data);
    },
    async delete(id) {
      return db.delete('posts', id);
    },
  }),
});

// Validate container before initialization
console.log('🔍 Validating container...');
const validation = container.validate();
if (!validation.success) {
  console.error('❌ Container validation failed:', validation.errors);
  process.exit(1);
}

console.log('✅ Container validated');
console.log(`   - Services: ${validation.resolvedOrder?.length}`);
console.log(`   - Initialization order: ${validation.resolvedOrder?.join(' → ')}`);

// ============================================================================
// 3. Introspection Test (AI Dev Module)
// ============================================================================

console.log('\n🔍 Phase 3: Container Introspection...');

const introspection = container.introspect();
console.log('✅ Introspection data:');
console.log(`   - Total services: ${introspection.services.length}`);
console.log(`   - Cycles detected: ${introspection.cycles.length}`);
console.log('   - Service graph:');
introspection.services.forEach(service => {
  const deps = service.dependencies.length > 0 ? ` ← [${service.dependencies.join(', ')}]` : '';
  console.log(`     • ${String(service.name)} (${service.scope})${deps}`);
});

// ============================================================================
// 4. Create Application (App Module)
// ============================================================================

console.log('\n🚀 Phase 4: Creating Application...');

const app = await createApp({
  container,
  config: {
    port: 3001,
    host: '127.0.0.1',
    env: 'development',
  },
});

console.log('✅ Application created');
console.log(`   - Fastify server: ready`);

// ============================================================================
// 5. Create Working Routes (with actual handlers)
// ============================================================================

console.log('\n📡 Phase 5: Registering Routes...');

// Get stores from container
const userStore = container.get('userStore');
const postStore = container.get('postStore');
const logger = container.get('logger');

// Validate middleware for users
const validateUserMiddleware = validateBody(UserModel.inputSchema);
const validatePostMiddleware = validateBody(PostModel.inputSchema);

const routes = [
  // Health check
  {
    method: 'GET',
    path: '/health',
    handler: async () => {
      return wrapSuccess({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: introspection.services.map(s => String(s.name))
      });
    },
  },

  // Container introspection
  {
    method: 'GET',
    path: '/__introspect/container',
    handler: async () => {
      return wrapSuccess(container.introspect());
    },
  },

  // Model introspection
  {
    method: 'GET',
    path: '/__introspect/models',
    handler: async () => {
      return wrapSuccess({
        models: [
          {
            name: UserModel.name,
            fields: UserModel.getFields(),
            relations: UserModel.getRelations(),
          },
          {
            name: PostModel.name,
            fields: PostModel.getFields(),
            relations: PostModel.getRelations(),
          }
        ]
      });
    },
  },

  // Seed data endpoint
  {
    method: 'POST',
    path: '/seed',
    handler: async () => {
      logger.info('Seeding database...');

      // Create sample users
      const user1 = await userStore.create({
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
        age: 30,
        isActive: true,
      });

      const user2 = await userStore.create({
        email: 'bob@example.com',
        firstName: 'Bob',
        lastName: 'Jones',
        age: 25,
        isActive: true,
      });

      // Create sample posts
      const post1 = await postStore.create({
        title: 'Hello World',
        content: 'My first post!',
        published: true,
        authorId: user1.id,
      });

      const post2 = await postStore.create({
        title: 'Building with Kinetic',
        content: 'This framework is awesome!',
        published: true,
        authorId: user1.id,
      });

      const post3 = await postStore.create({
        title: 'Draft Post',
        content: 'Still working on this...',
        published: false,
        authorId: user2.id,
      });

      return wrapSuccess({
        message: 'Seed data created successfully',
        usersCreated: 2,
        postsCreated: 3,
        users: [user1.id, user2.id],
        posts: [post1.id, post2.id, post3.id],
      });
    },
  },

  // USER CRUD OPERATIONS

  // Create user
  {
    method: 'POST',
    path: '/users',
    preHandler: [validateUserMiddleware],
    handler: async (request) => {
      const user = await userStore.create(request.body);
      return wrapSuccess(user);
    },
  },

  // List users (with pagination)
  {
    method: 'GET',
    path: '/users',
    preHandler: [rateLimit({ max: 100, window: 60 })],
    handler: async (request) => {
      const allUsers = await userStore.findAll();
      const { cursor, limit } = request.query || {};
      const result = enforcePagination(allUsers, { cursor, limit: limit ? parseInt(limit) : 10 });
      return result;
    },
  },

  // Get user by ID
  {
    method: 'GET',
    path: '/users/:id',
    handler: async (request) => {
      const user = await userStore.findById(request.params.id);
      if (!user) {
        throw new FrameworkError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'User not found',
          suggestion: 'Check that the user ID is valid',
        });
      }
      return wrapSuccess(user);
    },
  },

  // Update user
  {
    method: 'PUT',
    path: '/users/:id',
    preHandler: [validateUserMiddleware],
    handler: async (request) => {
      const user = await userStore.update(request.params.id, request.body);
      if (!user) {
        throw new FrameworkError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'User not found',
        });
      }
      return wrapSuccess(user);
    },
  },

  // Delete user
  {
    method: 'DELETE',
    path: '/users/:id',
    handler: async (request, reply) => {
      await userStore.delete(request.params.id);
      reply.status(204);
      return null;
    },
  },

  // POST CRUD OPERATIONS

  // Create post
  {
    method: 'POST',
    path: '/posts',
    preHandler: [validatePostMiddleware],
    handler: async (request) => {
      const post = await postStore.create(request.body);
      return wrapSuccess(post);
    },
  },

  // List posts
  {
    method: 'GET',
    path: '/posts',
    handler: async (request) => {
      const allPosts = await postStore.findAll();
      const { cursor, limit } = request.query || {};
      return enforcePagination(allPosts, { cursor, limit: limit ? parseInt(limit) : 10 });
    },
  },

  // Get post by ID
  {
    method: 'GET',
    path: '/posts/:id',
    handler: async (request) => {
      const post = await postStore.findById(request.params.id);
      if (!post) {
        throw new FrameworkError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Post not found',
        });
      }
      return wrapSuccess(post);
    },
  },

  // Update post
  {
    method: 'PUT',
    path: '/posts/:id',
    preHandler: [validatePostMiddleware],
    handler: async (request) => {
      const post = await postStore.update(request.params.id, request.body);
      if (!post) {
        throw new FrameworkError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Post not found',
        });
      }
      return wrapSuccess(post);
    },
  },

  // Delete post
  {
    method: 'DELETE',
    path: '/posts/:id',
    handler: async (request, reply) => {
      await postStore.delete(request.params.id);
      reply.status(204);
      return null;
    },
  },

  // Get posts by author
  {
    method: 'GET',
    path: '/users/:id/posts',
    handler: async (request) => {
      const posts = await postStore.findByAuthor(request.params.id);
      return wrapSuccess(posts);
    },
  },
];

// Register all routes
app.registerRoutes(routes);

console.log('✅ Routes registered:');
console.log(`   - Health: GET /health`);
console.log(`   - Introspection: GET /__introspect/container, /__introspect/models`);
console.log(`   - Seed: POST /seed`);
console.log(`   - Users: GET/POST/PUT/DELETE /users`);
console.log(`   - Posts: GET/POST/PUT/DELETE /posts`);

// ============================================================================
// 6. Pagination Test (Conventions Module)
// ============================================================================

console.log('\n📄 Phase 6: Testing Pagination...');

const testData = Array.from({ length: 50 }, (_, i) => ({
  id: `item-${i}`,
  name: `Item ${i}`,
}));

const paginated = enforcePagination(testData, { limit: 10 });
console.log('✅ Pagination working:');
console.log(`   - Items returned: ${paginated.data.length}`);
console.log(`   - Has more: ${paginated.pagination.hasMore}`);
console.log(`   - Total count: ${paginated.pagination.totalCount}`);

// ============================================================================
// 7. Framework Error Handling Test
// ============================================================================

console.log('\n⚠️  Phase 7: Testing Error Handling...');

const testError = new FrameworkError({
  code: ErrorCodes.VALIDATION_ERROR,
  message: 'Test validation error',
  suggestion: 'This is a test suggestion',
  docsUrl: '',
  field: 'email',
});

console.log('✅ FrameworkError created:');
console.log(`   - Code: ${testError.code}`);
console.log(`   - Message: ${testError.message}`);
console.log(`   - Suggestion: ${testError.suggestion}`);
console.log(`   - JSON: ${JSON.stringify(testError.toJSON())}`);

// ============================================================================
// 8. Start Server
// ============================================================================

console.log('\n🌟 Phase 8: Starting Server...');

await app.start();

console.log('✅ Server started successfully!');
console.log(`\n📡 API Endpoints:`);
console.log(`   - GET  http://127.0.0.1:3001/health`);
console.log(`   - GET  http://127.0.0.1:3001/__introspect/container`);
console.log(`   - GET  http://127.0.0.1:3001/__introspect/models`);
console.log(`   - POST http://127.0.0.1:3001/seed`);
console.log(`   - GET  http://127.0.0.1:3001/users`);
console.log(`   - POST http://127.0.0.1:3001/users`);
console.log(`   - GET  http://127.0.0.1:3001/posts`);
console.log(`   - POST http://127.0.0.1:3001/posts`);

console.log(`\n🔍 Try these commands:`);
console.log(`   curl http://127.0.0.1:3001/health`);
console.log(`   curl -X POST http://127.0.0.1:3001/seed`);
console.log(`   curl http://127.0.0.1:3001/__introspect/container`);
console.log(`   curl http://127.0.0.1:3001/users`);

// Keep server running
console.log('\nServer running. Press Ctrl+C to stop.');
await new Promise(() => {});
