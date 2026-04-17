/**
 * Basic CRUD Example
 * Demonstrates: defineModel, defineService, defineMiddleware, factory pattern, app bootstrap
 */

import { z } from 'zod';
import {
  createApp,
  MemoryStore,
  FrameworkError,
  ErrorCodes,
  defineService,
  defineMiddleware,
} from '@klusterio/kinetic-core';
import {
  defineModel,
  wrapSuccess,
  enforcePagination,
} from '@klusterio/kinetic-core/schema';

console.log('🚀 Basic CRUD Example\n');

const config = {
  name: 'Basic CRUD Example',
  version: '1.0.0',
  server: { port: 3000, host: '127.0.0.1' },
};

console.log('⚙️  Config loaded:', config.name, 'v' + config.version);

// ============================================================================
// Models
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
  relations: { posts: { type: 'hasMany', to: 'Post' } },
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
  relations: { author: { type: 'belongsTo', to: 'User', foreignKey: 'authorId' } },
});

console.log('📦 Models defined:');
console.log('   - User:', UserModel.getFields().length, 'fields');
console.log('   - Post:', PostModel.getFields().length, 'fields');

// ============================================================================
// Application
// ============================================================================

const app = await createApp({
  createAppContext: async () => {
    const logger = {
      info: (msg, data) => console.log(`[INFO] ${msg}`, data ?? ''),
      error: (msg, err) => console.error(`[ERROR] ${msg}`, err ?? ''),
    };

    // defineService wraps MemoryStore with lifecycle hooks — replaces manual
    // service factory boilerplate.
    const userService = defineService({
      store: new MemoryStore(),
      hooks: {
        beforeCreate: async (data) => {
          logger.info('Creating user', { email: data.email });
          return data;
        },
        beforeDelete: async (id) => {
          logger.info('Deleting user', { id });
        },
      },
    });

    const postService = defineService({
      store: new MemoryStore(),
      hooks: {
        beforeCreate: async (data) => {
          logger.info('Creating post', { title: data.title });
          return data;
        },
      },
    });

    return { logger, userService, postService };
  },
  fastifyOptions: { logger: false },
});

console.log('✅ App created with factory pattern + defineService');

// ============================================================================
// Middleware
// ============================================================================

// defineMiddleware gives each guard a name for introspection and stack traces.
const logRequest = defineMiddleware('logRequest', async (req) => {
  console.log(`[MW] ${req.method} ${req.url} (${req.id})`);
});

// ============================================================================
// Routes
// ============================================================================

const { userService, postService } = app.context;

app.get('/health', async () => ({
  status: 'healthy',
  timestamp: new Date().toISOString(),
  version: config.version,
}));

app.get('/introspect', async () => ({
  data: {
    services: ['userService', 'postService'],
    models: [UserModel.name, PostModel.name],
    middleware: [logRequest.name],
  },
}));

// User routes — preHandler uses the named middleware
app.post('/users', { preHandler: [logRequest.fn] }, async (request) => {
  const user = await userService.create(request.body);
  return wrapSuccess(user);
});

app.get('/users', async (request) => {
  const users = await userService.findAll();
  const { cursor, limit } = request.query || {};
  return enforcePagination(users, { cursor, limit: limit ? parseInt(limit) : 10 });
});

app.get('/users/:id', async (request) => {
  const user = await userService.findById(request.params.id);
  if (!user) throw new FrameworkError({ code: ErrorCodes.E_NF, c: 'E_NF', s: 'userService', r: 'not_found', t: Date.now() });
  return wrapSuccess(user);
});

app.put('/users/:id', async (request) => {
  const user = await userService.update(request.params.id, request.body);
  if (!user) throw new FrameworkError({ code: ErrorCodes.E_NF, c: 'E_NF', s: 'userService', r: 'not_found', t: Date.now() });
  return wrapSuccess(user);
});

app.delete('/users/:id', async (request, reply) => {
  await userService.delete(request.params.id);
  reply.status(204);
  return null;
});

// Post routes
app.post('/posts', async (request) => {
  const post = await postService.create(request.body);
  return wrapSuccess(post);
});

app.get('/posts', async (request) => {
  const posts = await postService.findAll();
  const { cursor, limit } = request.query || {};
  return enforcePagination(posts, { cursor, limit: limit ? parseInt(limit) : 10 });
});

app.get('/posts/:id', async (request) => {
  const post = await postService.findById(request.params.id);
  if (!post) throw new FrameworkError({ code: ErrorCodes.E_NF, c: 'E_NF', s: 'postService', r: 'not_found', t: Date.now() });
  return wrapSuccess(post);
});

app.get('/users/:id/posts', async (request) => {
  const all = await postService.findAll();
  return wrapSuccess(all.filter(p => p.authorId === request.params.id));
});

app.patch('/posts/:id/publish', async (request) => {
  const existing = await postService.findById(request.params.id);
  if (!existing) throw new FrameworkError({ code: ErrorCodes.E_NF, c: 'E_NF', s: 'postService', r: 'not_found', t: Date.now() });
  const post = await postService.update(request.params.id, { ...existing, published: true });
  return wrapSuccess(post);
});

app.delete('/posts/:id', async (request, reply) => {
  await postService.delete(request.params.id);
  reply.status(204);
  return null;
});

console.log('📡 Routes registered:', 14);

// ============================================================================
// Seed data
// ============================================================================

const users = [
  await userService.create({ email: 'alice@example.com', name: 'Alice Smith', age: 30, role: 'admin' }),
  await userService.create({ email: 'bob@example.com', name: 'Bob Jones', age: 25 }),
  await userService.create({ email: 'charlie@example.com', name: 'Charlie Brown', age: 35 }),
];

await postService.create({ title: 'Getting Started with Kinetic', content: 'This is a guide...', authorId: users[0].id, published: true });
await postService.create({ title: 'Advanced Features', content: 'Deep dive...', authorId: users[0].id });
await postService.create({ title: 'Best Practices', content: 'Tips and tricks...', authorId: users[1].id });

console.log('🌱 Seed data created:', users.length, 'users, 3 posts');

// ============================================================================
// Start
// ============================================================================

await app.listen({ port: config.server.port, host: config.server.host });

console.log('\n✅ Server started successfully!');
console.log(`\n📡 API: http://${config.server.host}:${config.server.port}`);

export { app, userService, postService };
