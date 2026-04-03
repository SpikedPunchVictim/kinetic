# Kinetic Framework - AI Agent Expert Skill

## Overview

Kinetic is an AI-Optimized Fastify Application Framework designed for AI-generated code that prioritizes token efficiency, code minimization, and compile-time safety. Architecture decisions are documented in ADR-001 and ADR-002.

---

## Core Philosophy

### AI-First Design
- **Primary user is AI, not humans** - All design decisions prioritize AI comprehension
- **Schema-first ground truth** - All types, validation, and contracts derive from Zod schemas
- **Token efficiency** - Minimize tokens required to express features

### Key Principles
1. **Explicit over implicit** - Clear data flow and dependencies
2. **Compile-time safety** - TypeScript validates at build time, not runtime
3. **Factory pattern** - No container-based DI with magic dependency injection
4. **Composition over inheritance** - Dependency injection through explicit functions

---

## Architecture

#### Correct Pattern: Explicit Context Factory

```typescript
// Define your context types
interface AppContext {
  db: DbService;
  cache: CacheService;
  jwt: JwtService;
  otel: OtelService; // Optional addon
}

interface RequestContext {
  user: User;
  span: Span;
}

// Create app with explicit context
const app = await createApp<AppContext, RequestContext>({
  createAppContext: async () => {
    // Order is EXPLICIT - no magic
    const db = await DbAddon.create(env.DATABASE_URL);
    const cache = await CacheAddon.create({ db });
    const jwt = await JwtAddon.create({ secret: env.JWT_SECRET });
    const otel = await OtelAddon.create({ serviceName: 'my-app' });

    return { db, cache, jwt, otel };
  },

  createRequestContext: async (req, appCtx) => {
    // Per-request context
    const user = await verifyToken(req.headers.authorization, appCtx.jwt);
    const span = appCtx.otel.startSpan(req.url);
    return { user, span };
  },
});

// Access context in handlers
app.get('/users', async (req) => {
  const user = await req.appContext.db.query('SELECT * FROM users');
  req.requestContext.span.setAttribute('user.count', user.length);
  return user;
});
```

---

## Core API Reference

### Application Bootstrap

```typescript
import { createApp } from '@klusterio/kinetic-core';

const app = await createApp<AppContext, RequestContext>({
  createAppContext: async () => ({ /* services */ }),
  createRequestContext: async (req, appCtx) => ({ /* per-request data */ }),
  fastifyOptions: { logger: true }, // Optional Fastify options
});

// Start server
await app.listen({ port: 3000, host: '0.0.0.0' });
```

### Schema Definition

```typescript
import { defineModel } from '@klusterio/kinetic-core/schema';
import { z } from 'zod';

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1).max(100),
    age: z.number().int().min(0).optional(),
    role: z.enum(['user', 'admin']).default('user'),
    createdAt: z.date().default(() => new Date()),
  },
  relations: {
    posts: { type: 'hasMany', to: 'Post' },
  },
});

// Get derived types
import type { Model } from '@klusterio/kinetic-core';
type User = Model<typeof UserModel>;
```

### CRUD Operations (ICrud Interface)

```typescript
import { MemoryStore } from '@klusterio/kinetic-core';
import { generateCrudRoutes } from '@klusterio/kinetic-core/schema';

const userStore: ICrud<User> = new MemoryStore();

const routes = generateCrudRoutes(UserModel, {
  store: userStore, // REQUIRED - implements ICrud
  middleware: {
    create: [authMiddleware],
    read: [],
    update: [authMiddleware, adminOnly],
    delete: [authMiddleware, adminOnly],
  },
});

app.registerRoutes(routes);
```

#### ICrud Interface

```typescript
interface ICrud<T, CreateInput = Omit<T, 'id'>, UpdateInput = Partial<T>> {
  create(data: CreateInput): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(options?: { cursor?: string; limit?: number }): Promise<T[]>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

// Custom implementation
const dbStore: ICrud<User> = {
  create: async (data) => {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },
  findById: async (id) => {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || null;
  },
  // ...implement rest
};
```

---

## Error Handling

### Token-Efficient Error Format

Kinetic uses condensed error codes to minimize token usage:

```typescript
import { FrameworkError } from '@klusterio/kinetic-core';

// Correct: Token-efficient
throw new FrameworkError({
  c: 'E_VALID',    // code: compact
  s: 'User',        // service/resource
  r: 'email_fmt',   // reason: abbreviated
  t: Date.now(),    // timestamp for tracing
});

// JSON output: {"c":"E_VALID","s":"User","r":"email_fmt","t":1711234567890}
// ~55 chars = ~14 tokens (vs ~45 tokens for verbose format)
```

### Error Code Reference

| Code | Meaning | HTTP Status |
|------|---------|-------------|
| `E_VALID` | Validation failed | 400 |
| `E_AUTH` | Authentication required | 401 |
| `E_FORBID` | Forbidden (insufficient permissions) | 403 |
| `E_NOTFOUND` | Resource not found | 404 |
| `E_DUP` | Duplicate/resource exists | 409 |
| `E_SERVER` | Internal server error | 500 |
| `E_INIT` | Initialization failed | 500 |

---

## Schema Module

### Model Operations

```typescript
import { defineModel, generateUrlPath, wrapSuccess, wrapList } from '@klusterio/kinetic-core/schema';

// URL path generation (pluralization)
const path = generateUrlPath('User'); // '/users'

// Response wrappers
wrapSuccess({ id: '123', name: 'John' });
// { success: true, data: { id: '123', name: 'John' } }

wrapList([user1, user2], { total: 100, page: 1, limit: 20 });
// { success: true, data: [...], meta: { total: 100, page: 1, limit: 20 } }

// Pagination enforcement
import { enforcePagination } from '@klusterio/kinetic-core/schema';

const pagination = enforcePagination({ page: 1, limit: 100 }, { maxLimit: 50 });
// Returns: { page: 1, limit: 50 } (enforced max)
```

---

## Security Module

### Validation Middleware

```typescript
import { validateBody, validateParams } from '@klusterio/kinetic-core/security';

app.post('/users', {
  preHandler: [validateBody(UserModel.inputSchema)],
  handler: async (req) => {
    // req.body is validated
    return await createUser(req.body);
  },
});
```

### Rate Limiting

```typescript
import { rateLimit } from '@klusterio/kinetic-core/security';

app.post('/login', {
  preHandler: [rateLimit({ max: 5, window: 300 })], // 5 requests per 5 minutes
  handler: async (req) => { /* ... */ },
});
```

### Auth Hooks

```typescript
import { createAuthHook, extractBearerToken } from '@klusterio/kinetic-core/security';

const authHook = createAuthHook(async (request) => {
  const token = extractBearerToken(request.headers);
  if (!token) return { success: false, error: 'No token' };

  try {
    const user = await verifyToken(token);
    return { success: true, user };
  } catch {
    return { success: false, error: 'Invalid token' };
  }
});

// Use in route
app.get('/protected', async (req) => {
  const result = await authHook(req);
  if (!result.success) {
    throw new FrameworkError({ c: 'E_AUTH', s: 'protected', r: result.error });
  }
  return { user: result.user };
});
```

---

## Observability Module

### Core Observability (Built-in)

```typescript
import { createLogger, Metrics, Health, tracer } from '@klusterio/kinetic-core/observability';

// Logger
const logger = createLogger({ level: 'info', format: 'json' });
logger.info('User created', { userId: '123' });

// Metrics
Metrics.counter('http.requests').inc(1, { route: '/users' });
Metrics.histogram('request.duration').observe(0.150, { route: '/users' });

// Health checks
Health.register({
  name: 'database',
  check: async () => {
    const connected = await checkDbConnection();
    return { status: connected ? 'up' : 'down', details: { latency: '2ms' } };
  },
});

// Tracing (in-memory, development)
const span = tracer.startSpan('database-query', { table: 'users' });
tracer.endSpan(span, 'ok');
```

### OpenTelemetry Add-on (Production)

```typescript
import { OtelAddon } from '@klusterio/addon-otel';

const otel = await OtelAddon.create({
  serviceName: 'my-service',
  serviceVersion: '1.0.0',
  environment: 'production',
  tracesEndpoint: 'http://localhost:4318/v1/traces',
  metricsEndpoint: 'http://localhost:4318/v1/metrics',
  samplingRatio: 0.1, // 10% sampling in production
});

// In app context
const app = await createApp<{ otel: typeof otel }>({
  createAppContext: async () => ({ otel }),
});

// Register automatic HTTP tracing
await OtelAddon.registerHooks(app, otel, {
  skipPaths: ['/health', '/metrics'],
});

// Manual spans
const span = otel.startSpan('custom-operation', { 'custom.attr': 'value' });
span.setAttribute('result', 'success');
span.end();

// Metrics
const counter = otel.createCounter('requests_total');
counter?.add(1, { method: 'GET', route: '/users' });

// Graceful shutdown
await otel.shutdown();
```

---

## Add-ons

### Pattern: Factory Functions

Add-ons follow the factory pattern, exporting factory functions not classes:

```typescript
// Correct addon pattern
export const MyAddon = {
  async create(config: MyConfig): Promise<MyService> {
    return new MyServiceImpl(config);
  },

  registerHooks(fastify: FastifyInstance, service: MyService): void {
    fastify.addHook('onReady', async () => {
      await service.initialize();
    });
  },

  async withSpan<T>(service: MyService, name: string, fn: () => Promise<T>): Promise<T> {
    const span = service.startSpan(name);
    try {
      return await fn();
    } finally {
      span.end();
    }
  }
};

// Usage
const service = await MyAddon.create(config);
MyAddon.registerHooks(app, service);
```

### Available Add-ons

- `@klusterio/addon-otel` - OpenTelemetry tracing and metrics
- `@klusterio/addon-jwt` - JWT authentication

---

## Type Safety

### Accessing Context in Handlers

```typescript
import type { FastifyRequest } from 'fastify';
import type { FastifyRequestWithContexts } from '@klusterio/kinetic-core';

interface AppContext {
  db: Database;
  jwt: JwtService;
}

interface RequestContext {
  user: User;
}

app.get('/users', async (req: FastifyRequestWithContexts<AppContext, RequestContext>) => {
  const users = await req.appContext.db.query('SELECT * FROM users');
  const currentUser = req.requestContext.user;
  return { users, currentUser };
});
```

---

## Testing

### Test-First Development

```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from '@klusterio/kinetic-core';

describe('User API', () => {
  it('creates users', async () => {
    const app = await createApp({
      createAppContext: async () => ({ db: mockDb }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { email: 'test@example.com', name: 'Test' },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).data.email).toBe('test@example.com');
  });
});
```

---

## Common Patterns

### Route Definition Pattern

```typescript
const routes = [
  {
    method: 'GET',
    path: '/users',
    handler: async (request, reply) => {
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
];

// Register routes
for (const route of routes) {
  app.route(route);
}
```

### Service Pattern

```typescript
// Factory function
function createUserService(db: Database, logger: Logger) {
  return {
    async create(data: CreateUserInput) {
      logger.info('Creating user', { email: data.email });
      return db.insert('users', data);
    },
    async findById(id: string) {
      return db.findOne('users', { id });
    },
    // ...
  };
}

// Use in context
const app = await createApp<{
  userService: ReturnType<typeof createUserService>;
}>({
  createAppContext: async () => {
    const db = await DbAddon.create(env.DATABASE_URL);
    const logger = createLogger();
    const userService = createUserService(db, logger);
    return { userService };
  },
});
```

### Error Handling Pattern

```typescript
app.get('/users/:id', async (req) => {
  try {
    const user = await userService.findById(req.params.id);
    if (!user) {
      throw new FrameworkError({
        c: 'E_NOTFOUND',
        s: 'User',
        r: 'id_invalid',
        t: Date.now(),
      });
    }
    return wrapSuccess(user);
  } catch (err) {
    if (err instanceof FrameworkError) throw err;

    // Wrapped unexpected errors
    throw new FrameworkError({
      c: 'E_SERVER',
      s: 'User',
      r: err instanceof Error ? err.message.slice(0, 30) : 'unknown',
      t: Date.now(),
    });
  }
});
```

---

## Anti-Patterns (NEVER DO)

### ❌ Implicit Dependencies

```typescript
// DON'T - Dependencies must be explicit
async function createUserService() {
  const db = getGlobalDb(); // ❌ Hidden dependency
  return { /* ... */ };
}

// DO - Explicit injection
function createUserService(db: Database) {
  return { /* ... */ };
}
```

### ❌ Runtime Type Checking

```typescript
// DON'T - Runtime regex doesn't work with bundlers
function extractDependencies(fn: Function) {
  const str = fn.toString();
  const match = str.match(/\{([^}]+)\}/); // ❌ Breaks with minification
  return match ? match[1].split(',') : [];
}

// DO - Compile-time type checking via TypeScript
interface AppContext {
  db: Database; // ✅ TypeScript validates
}
```

### ❌ Verbose Error Messages

```typescript
// DON'T - Wastes tokens (45 tokens)
throw new FrameworkError({
  code: 'VALIDATION_ERROR',
  message: 'Failed to validate user input',
  suggestion: 'Check email format',
  docsUrl: '', // Empty string wastes tokens
});

// DO - Condensed format (14 tokens)
throw new FrameworkError({
  c: 'E_VALID',
  s: 'User',
  r: 'email_fmt',
  t: Date.now(),
});
```

---

## Project Structure

```
project/
├── src/
│   ├── app.ts              # Application bootstrap
│   ├── services/           # Business logic
│   ├── routes.ts           # Route definitions
│   └── types.ts            # Shared types
├── tests/
│   └── *.test.ts
└── package.json
```

### Dependencies

```json
{
  "dependencies": {
    "@klusterio/kinetic-core": "workspace:*",
    "@klusterio/addon-otel": "workspace:*",  // Optional
    "@klusterio/addon-jwt": "workspace:*",   // Optional
    "zod": "^3.22.0",
    "fastify": "^5.0.0"
  }
}
```

---

## Quick Reference

### Imports Cheat Sheet

```typescript
// Core
import { createApp, FrameworkError } from '@klusterio/kinetic-core';

// Schema
import { defineModel, generateUrlPath, wrapSuccess } from '@klusterio/kinetic-core/schema';

// Security
import { validateBody, rateLimit, extractBearerToken } from '@klusterio/kinetic-core/security';

// Observability
import { createLogger, Metrics, Health } from '@klusterio/kinetic-core/observability';

// AI Dev
import { registerIntrospectionRoutes } from '@klusterio/kinetic-core/ai-dev';

// Addons
import { OtelAddon } from '@klusterio/addon-otel';
import { JwtAddon } from '@klusterio/addon-jwt';

// Types
import type {
  CreateAppOptions,
  FastifyWithContext,
  ICrud
} from '@klusterio/kinetic-core';
```

---

## Resources

- **ADR-001**: AI-Optimized Fastify Application Framework
- **ADR-002**: Framework Course Correction (Factory Pattern)
- **API Reference**: `/API_REFERENCE.md`
- **Examples**: `/examples/`

---

## Decision Framework

When working with Kinetic, prefer:

1. **Factory functions** over classes
2. **Explicit dependencies** over dependency injection containers
3. **Zod schemas** over runtime validation
4. **Type-safe context** over global state
5. **Condensed errors** over verbose messages
6. **Composition** over inheritance
7. **Test-first** development

