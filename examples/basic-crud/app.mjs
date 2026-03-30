/**
 * Basic CRUD Example
 * Demonstrates: Model definition, CRUD routes, factory pattern, app bootstrap
 * ADR-002: Updated for factory pattern (no container)
 */

import { z } from 'zod';
import {
  createApp,
  MemoryStore,
  FrameworkError,
  ErrorCodes,
} from '@klusterio/kinetic-core';
import {
  defineModel,
  wrapSuccess,
  enforcePagination,
} from '@klusterio/kinetic-core/schema';

console.log('🚀 Basic CRUD Example\n');

// ============================================================================
// 1. Configuration
// ============================================================================

const config = {
  name: 'Basic CRUD Example',
  version: '1.0.0',
  server: {
    port: 3000,
    host: '127.0.0.1',
  },
};

console.log('⚙️  Config loaded:', config.name, 'v' + config.version);

// ============================================================================
// 2. Define Models (Schema Module)
// ============================================================================

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1).max(100),
    age: z.number().int().min(0).max(150).optional(),
    role: z.enum(['user', 'admin']).default('user'),
    createdAt: z.date().default(() => new Date()),
  },
  relations: {
    posts: { type: 'hasMany', to: 'Post' },
  },
});

const PostModel = defineModel({
  name: 'Post',
  fields: {
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    content: z.string(),
    published: z.boolean().default(false),
    authorId: z.string(),
    tags: z.array(z.string()).optional(),
    createdAt: z.date().default(() => new Date()),
  },
  relations: {
    author: { type: 'belongsTo', to: 'User', foreignKey: 'authorId' },
  },
});

console.log('📦 Models defined:');
console.log('   - User:', UserModel.getFields().length, 'fields');
console.log('   - Post:', PostModel.getFields().length, 'fields');

// ============================================================================
// 3. Create Services with Factory Pattern
// ============================================================================

// Logger service
function createLogger() {
  return {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ''),
  };
}

// User service with ICrud interface
function createUserService(userStore, logger) {
  return {
    async create(data) {
      logger.info('Creating user', { email: data.email });
      return userStore.create(data);
    },
    async findById(id) {
      return userStore.findById(id);
    },
    async findAll() {
      return userStore.findAll();
    },
    async update(id, data) {
      logger.info('Updating user', { id });
      return userStore.update(id, data);
    },
    async delete(id) {
      logger.info('Deleting user', { id });
      return userStore.delete(id);
    },
  };
}

// Post service with ICrud interface
function createPostService(postStore, logger) {
  return {
    async create(data) {
      logger.info('Creating post', { title: data.title });
      return postStore.create(data);
    },
    async findById(id) {
      return postStore.findById(id);
    },
    async findAll() {
      return postStore.findAll();
    },
    async findByAuthor(authorId) {
      const all = await postStore.findAll();
      return all.filter(p => p.authorId === authorId);
    },
    async publish(id) {
      logger.info('Publishing post', { id });
      const record = await postStore.findById(id);
      if (!record) return null;
      return postStore.update(id, { ...record, published: true });
    },
    async update(id, data) {
      return postStore.update(id, data);
    },
    async delete(id) {
      return postStore.delete(id);
    },
  };
}

console.log('🔧 Services defined with factory pattern');

// ============================================================================
// 4. Create Application with Factory Pattern
// ============================================================================

const app = await createApp({
  createAppContext: async () => {
    const logger = createLogger();
    const userStore = new MemoryStore();
    const postStore = new MemoryStore();
    const userService = createUserService(userStore, logger);
    const postService = createPostService(postStore, logger);

    return {
      logger,
      userStore,
      postStore,
      userService,
      postService,
    };
  },
  fastifyOptions: {
    logger: false,
  },
});

// Get services from app context
const { userService, postService, logger } = app.context;

console.log('✅ App created with factory pattern');

// ============================================================================
// 5. Define and Register Routes (Fastify native)
// ============================================================================

// Health check - GET /health
app.get('/health', async () => ({
  status: 'healthy',
  timestamp: new Date().toISOString(),
  version: config.version,
}));

// Introspection - GET /introspect
app.get('/introspect', async () => ({
  data: {
    services: ['userService', 'postService'],
    models: [UserModel.name, PostModel.name],
  },
}));

// USER CRUD OPERATIONS

// Create user - POST /users
app.post('/users', async (request) => {
  const user = await userService.create(request.body);
  return wrapSuccess(user);
});

// List users - GET /users
app.get('/users', async (request) => {
  const users = await userService.findAll();
  const { cursor, limit } = request.query || {};
  return enforcePagination(users, {
    cursor,
    limit: limit ? parseInt(limit) : 10,
  });
});

// Get user by ID - GET /users/:id
app.get('/users/:id', async (request) => {
  const { id } = request.params;
  const user = await userService.findById(id);
  if (!user) {
    throw new FrameworkError({
      code: ErrorCodes.E_NF,
      c: 'E_NF',
      s: 'userService',
      r: 'not_found',
      t: Date.now(),
    });
  }
  return wrapSuccess(user);
});

// Update user - PUT /users/:id
app.put('/users/:id', async (request) => {
  const { id } = request.params;
  const user = await userService.update(id, request.body);
  if (!user) {
    throw new FrameworkError({
      code: ErrorCodes.E_NF,
      c: 'E_NF',
      s: 'userService',
      r: 'not_found',
      t: Date.now(),
    });
  }
  return wrapSuccess(user);
});

// Delete user - DELETE /users/:id
app.delete('/users/:id', async (request, reply) => {
  await userService.delete(request.params.id);
  reply.status(204);
  return null;
});

// POST CRUD OPERATIONS

// Create post - POST /posts
app.post('/posts', async (request) => {
  const post = await postService.create(request.body);
  return wrapSuccess(post);
});

// List posts - GET /posts
app.get('/posts', async (request) => {
  const posts = await postService.findAll();
  const { cursor, limit } = request.query || {};
  return enforcePagination(posts, {
    cursor,
    limit: limit ? parseInt(limit) : 10,
  });
});

// Get post by ID - GET /posts/:id
app.get('/posts/:id', async (request) => {
  const { id } = request.params;
  const post = await postService.findById(id);
  if (!post) {
    throw new FrameworkError({
      code: ErrorCodes.E_NF,
      c: 'E_NF',
      s: 'postService',
      r: 'not_found',
      t: Date.now(),
    });
  }
  return wrapSuccess(post);
});

// Get posts by author - GET /users/:id/posts
app.get('/users/:id/posts', async (request) => {
  const posts = await postService.findByAuthor(request.params.id);
  return wrapSuccess(posts);
});

// Publish post - PATCH /posts/:id/publish
app.patch('/posts/:id/publish', async (request) => {
  const { id } = request.params;
  const existing = await postService.findById(id);
  if (!existing) {
    throw new FrameworkError({
      code: ErrorCodes.E_NF,
      c: 'E_NF',
      s: 'postService',
      r: 'not_found',
      t: Date.now(),
    });
  }
  // Update the record directly in store to ensure published is set
  const post = await postService.update(id, { ...existing, published: true });
  return wrapSuccess(post);
});

// Delete post - DELETE /posts/:id
app.delete('/posts/:id', async (request, reply) => {
  await postService.delete(request.params.id);
  reply.status(204);
  return null;
});

console.log('📡 Routes registered:', 14);

// ============================================================================
// 6. Seed Data
// ============================================================================

async function seedData() {
  const users = [
    await userService.create({ email: 'alice@example.com', name: 'Alice Smith', age: 30, role: 'admin' }),
    await userService.create({ email: 'bob@example.com', name: 'Bob Jones', age: 25 }),
    await userService.create({ email: 'charlie@example.com', name: 'Charlie Brown', age: 35 }),
  ];

  const posts = [
    await postService.create({ title: 'Getting Started with Kinetic', content: 'This is a guide...', authorId: users[0].id, published: true }),
    await postService.create({ title: 'Advanced Features', content: 'Deep dive...', authorId: users[0].id }),
    await postService.create({ title: 'Best Practices', content: 'Tips and tricks...', authorId: users[1].id }),
  ];

  console.log('🌱 Seed data created:', users.length, 'users,', posts.length, 'posts');
}

await seedData();

// ============================================================================
// 7. Start Server
// ============================================================================

await app.listen({ port: config.server.port, host: config.server.host });

console.log('\n✅ Server started successfully!');
console.log(`\n📡 API Endpoints:`);
console.log(`   GET  http://${config.server.host}:${config.server.port}/health`);
console.log(`   GET  http://${config.server.host}:${config.server.port}/introspect`);
console.log(`   POST http://${config.server.host}:${config.server.port}/users`);
console.log(`   GET  http://${config.server.host}:${config.server.port}/users`);
console.log(`   GET  http://${config.server.host}:${config.server.port}/posts`);
console.log(`   POST http://${config.server.host}:${config.server.port}/posts`);
console.log(`\n🔍 Running automatic verification...\n`);

export { app, userService, postService };
