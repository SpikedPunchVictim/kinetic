# @klusterio/kinetic-core

<p align="center">
  <strong>Production-Ready TypeScript Framework for APIs</strong><br>
  Compile-Time Type-Safety • Auto-CRUD • Built-in Observability • Convention Enforcement
</p>

---

## Install

```bash
npm install @klusterio/kinetic-core zod
# or
yarn add @klusterio/kinetic-core zod
# or
pnpm add @klusterio/kinetic-core zod
```

**Requirements:** Node.js 18+ • TypeScript 5.0+

---

## 30-Second Quick Start

```typescript
import { createApp, MemoryStore } from '@klusterio/kinetic-core';
import { defineModel, generateCrudRoutes } from '@klusterio/kinetic-core/schema';
import { z } from 'zod';

// 1. Define your data model
const Todo = defineModel({
  name: 'Todo',
  fields: {
    title: z.string().min(1),
    done: z.boolean().default(false),
  },
});

// 2. Create app with explicit type-safe context
type AppContext = {
  db: { todos: typeof Todo[] };
};

const app = await createApp<AppContext>({
  createAppContext: async () => ({
    db: { todos: [] },
  }),
});

// 3. Generate CRUD routes automatically
const routes = generateCrudRoutes(Todo, {
  store: new MemoryStore(), // Or your own ICrud implementation
});

// 4. Register routes
for (const route of routes) {
  app.route(route);
}

await app.listen({ port: 3000 });
console.log('http://localhost:3000');
```

---

## Progressive Guide

### Level 1: Basic CRUD App

**Goal:** Create a fully-featured User API with type-safe context factory.

```typescript
import { z } from 'zod';
import { createApp, MemoryStore, FrameworkError } from '@klusterio/kinetic-core';
import { defineModel, generateCrudRoutes } from '@klusterio/kinetic-core/schema';

// Model with validation
const User = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1),
    age: z.number().optional(),
  },
});

// Define app context types
type AppContext = {
  userStore: MemoryStore<User>;
};

// Create app with factory pattern - explicit dependency creation
const app = await createApp<AppContext>({
  createAppContext: async () => ({
    userStore: new MemoryStore<User>(),
  }),
});

// Generate all CRUD routes automatically
const routes = generateCrudRoutes(User, {
  store: app.context.userStore,
});

// Register routes
for (const route of routes) {
  app.route(route);
}

await app.listen({ port: 3000 });
```

**Run it:**
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","age":30}'
# → { "id": "...", "email": "alice@example.com", ... }

curl http://localhost:3000/users
# → [{ "id": "...", "email": "alice@example.com", ... }]
```

---

### Level 2: Multi-Layer Architecture with Request Context

**Goal:** Separate concerns with Repository + Service layers, plus per-request context.

```typescript
import { createApp } from '@klusterio/kinetic-core';

// Domain types
type AppContext = {
  db: Database;
  userService: UserService;
};

type RequestContext = {
  user: { id: string } | null;
  traceId: string;
};

// Create app with both app and request context
const app = await createApp<AppContext, RequestContext>({
  createAppContext: async () => {
    // App-level initialization
    const db = await Database.connect(process.env.DATABASE_URL);
    const userService = new UserService(db);

    return { db, userService };
  },

  createRequestContext: async (req, appCtx) => {
    // Per-request initialization
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    const user = token ? await appCtx.userService.verifyToken(token) : null;

    return { user, traceId: crypto.randomUUID() };
  },
});

// Routes have access to both contexts
app.get('/profile', async (req, reply) => {
  // Request context (per-request, fresh) - use requestContext not context
  const currentUser = (req as any).requestContext?.user;
  if (!currentUser) return reply.status(401).send({ error: 'Unauthorized' });

  // App context (shared across all requests)
  const profile = await (req as any).appContext.userService.getProfile(currentUser.id);

  reply.send({ data: profile });
});
```

---

### Level 3: Security, JWT & Rate Limiting

**Goal:** Add authentication using JWT addon with explicit factory pattern.

```typescript
import { JwtAddon } from '@klusterio/kinetic-jwt-addon';
import { createApp, MemoryStore } from '@klusterio/kinetic-core';

type AppContext = {
  db: Database;
  jwt: Awaited<ReturnType<typeof JwtAddon.create>>;
  userStore: MemoryStore<User>;
};

type RequestContext = {
  user: { id: string } | null;
};

const app = await createApp<AppContext, RequestContext>({
  createAppContext: async () => {
    // Explicit initialization order - you control it!
    const db = await Database.connect(process.env.DATABASE_URL);
    const userStore = new MemoryStore<User>();
    const jwt = await JwtAddon.create({
      secret: process.env.JWT_SECRET!,
      expiresIn: '1h',
    });

    return { db, jwt, userStore };
  },

  createRequestContext: async (req, appCtx) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return { user: null };

    try {
      const claims = await appCtx.jwt.verify(token);
      return { user: { id: claims.sub as string } };
    } catch {
      return { user: null };
    }
  },
});

// Apply JWT middleware
await app.context.jwt.middleware(app);

// Protected route
app.get('/admin-only', async (req, reply) => {
  const user = req.context.user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  // Access app services
  const admin = await req.appContext.userStore.findById(user.id);
  if (!admin?.isAdmin) return reply.status(403).send({ error: 'Forbidden' });

  return { data: { message: 'Secret data' } };
});
```

---

### Level 4: Observability & Tracing

**Goal:** Built-in tracing with InMemoryTracer for dev, pluggable for prod.

```typescript
import { createApp, InMemoryTracer, registerTraceEndpoint } from '@klusterio/kinetic-core';

type AppContext = {
  tracer: InMemoryTracer;
  userService: UserService;
};

const app = await createApp<AppContext>({
  createAppContext: async () => {
    const tracer = new InMemoryTracer(); // 2500 line auto-rotation
    const userService = new UserService({ tracer });

    return { tracer, userService };
  },
});

// Register debug trace endpoint in dev
if (process.env.NODE_ENV === 'development') {
  registerTraceEndpoint(app, app.context.tracer);
  // GET /__debug/traces - Returns recent traces
}

// Traced route
app.post('/orders', async (req, reply) => {
  const span = req.appContext.tracer.startSpan('order.create');
  span.setAttribute('userId', req.context.user?.id);

  try {
    const order = await req.appContext.userService.createOrder(req.body);
    span.end();
    return reply.status(201).send(order);
  } catch (err) {
    span.setAttribute('error', err instanceof Error ? err.message : 'unknown');
    span.end();
    return reply.status(500).send({ error: 'Failed' });
  }
});
```

---

### Level 5: Security-Gated Introspection

**Goal:** Safe introspection for development, disabled in production.

```typescript
import {
  createApp,
  registerSecureIntrospection
} from '@klusterio/kinetic-core';
import { generateCrudRoutes } from '@klusterio/kinetic-core/schema';

const app = await createApp<AppContext>({
  createAppContext: async () => ({ /* ... */ }),
});

const routes = generateCrudRoutes(UserModel, { store });
for (const route of routes) app.route(route);

// Introspection endpoint - automatically:
// 1. Only works in NODE_ENV=development by default
// 2. Warns if explicitly enabled in production
// 3. Requires `allowInProduction: true` to bypass safety
registerSecureIntrospection(app, {
  routes,
  models: [UserModel, OrderModel],
  // enabled: true,  // Optional - defaults to dev mode
  // allowInProduction: false, // Safety override (not recommended)
});

// Available in dev:
// GET /__introspect/routes    - Route definitions
// GET /__introspect/schema    - Model introspection
// GET /__introspect/conventions - Framework conventions
// GET /__introspect/errors    - Recent error log
```

---

## Type Safety: Extending FastifyRequest

To get full TypeScript intellisense for contexts without casting to `any`:

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';

// 1. Define your context types
interface MyAppContext {
  db: Database;
  userService: UserService;
}

interface MyRequestContext {
  user: { id: string } | null;
  traceId: string;
}

// 2. Extend FastifyRequest module (place in your types file)
declare module 'fastify' {
  interface FastifyRequest {
    // NOTE: Use 'requestContext' not 'context' (Fastify reserves 'context')
    requestContext: MyRequestContext;
    appContext: MyAppContext;
  }
}

// 3. Now you get full type safety in handlers
app.get('/users', async (req: FastifyRequest, reply: FastifyReply) => {
  // req.requestContext is fully typed!
  const { user, traceId } = req.requestContext;

  // req.appContext is fully typed!
  const { userService } = req.appContext;

  const users = await userService.getAll();
  return reply.code(200).send(users);
});
```

### Why `requestContext` instead of `context`?

Fastify's `FastifyRequest` already has a read-only `context` property used internally. We use `requestContext` to avoid conflicts.

```typescript
// ❌ Wrong - causes runtime error
req.context = { user: null }; // Error: Cannot set property context!

// ✅ Correct
req.requestContext = { user: null }; // Works!
```

---

## API Reference

### Core Application

| Function | Description |
|----------|-------------|
| `createApp<TAppContext, TRequestContext?>(options)` | Create Fastify app with typed contexts |
| `createAppContext` | Factory function for app-level services |
| `createRequestContext` | Optional factory for per-request context |

### Schema & CRUD

| Function | Description |
|----------|-------------|
| `defineModel(definition)` | Define data model with Zod |
| `model.inputSchema` | Schema for create/update (excludes auto-fields) |
| `model.outputSchema` | Full schema for responses |
| `generateCrudRoutes(model, { store })` | Auto-generate REST routes using ICrud |
| `MemoryStore<T>()` | In-memory ICrud implementation for dev/testing |

**ICrud Interface:**
```typescript
interface ICrud<T> {
  create(data: Omit<T, 'id'>): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(opts?: { cursor?: string; limit?: number }): Promise<T[]>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}
```

### Errors

| Constant | Description |
|----------|-------------|
| `E_INIT` | Initialization failed |
| `E_INIT_CONN` | Connection failed |
| `E_NF` | Not found |
| `E_VAL` | Validation failed |
| `E_DB` | Database error |
| `E_AUTH` | Authentication failed |

```typescript
// Condensed error format - 14 tokens
throw new FrameworkError({
  code: 'E_NF',
  c: 'E_NF',
  s: 'userService',
  r: 'user_not_found',
  t: Date.now(),
});
// → { "c": "E_NF", "s": "userService", "r": "user_not_found", "t": 1234567890 }
```

### Observability

| Function/Class | Description |
|----------------|-------------|
| `InMemoryTracer` | Built-in tracer with 2500-line rotation |
| `registerTraceEndpoint(app, tracer)` | Debug endpoint for traces |
| `registerSecureIntrospection(app, opts)` | Security-gated introspection |

---

## Migration from Container Pattern

If you were using the old container-based API:

```typescript
// OLD (deleted)
const container = createContainer();
container.register('db', async () => new Database());
container.register('svc', async ({ db }) => new Service(db));
await container.initialize();
const db = container.get('db');

// NEW (ADR-002)
const app = await createApp<{ db: Database }>({
  createAppContext: async () => {
    const db = await Database.connect(url);
    const svc = new Service(db); // Explicit!
    return { db, svc };
  },
});
// Access: app.context.db
```

**Why this is better:**
- ✅ True compile-time validation
- ✅ No `fn.toString()` runtime extraction
- ✅ Works with any bundler (webpack, esbuild)
- ✅ Transparent - code shows exactly what's happening
- ✅ 3x fewer tokens in error messages

---

## Need Help?

- **Architecture Decision Record:** [ADR-002](/Users/spikedpunchvictim/projects/kinetic/.claude/arch/adr-002-support/README.md)
- **Issues:** [GitHub Issues](../../issues)
- **Discussions:** [GitHub Discussions](../../discussions)

---

<p align="center">
  <strong>MIT License</strong> • Built with explicit factories, not magic
</p>
