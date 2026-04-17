# Kinetic Framework — Agent Skill

Kinetic is an AI-optimised Fastify framework. Its primary goal is reducing the token cost of AI-assisted backend development through convention enforcement, compact errors, and a single introspection endpoint that surfaces the full app surface in one request.

---

## Mental model

```
defineEnv()        → validate env vars per-module, register to /__introspect
defineModel()      → declare Zod schema + naming conventions
defineService()    → wrap ICrud store with lifecycle hooks
defineMiddleware() → named Fastify preHandler
createApp()        → bootstrap Fastify with typed app/request contexts
```

Services never reach into `process.env` directly. Every module that needs env vars calls `defineEnv()` at the top of its file.

---

## Package imports

```typescript
// Core — main entry
import {
  createApp,
  defineEnv,
  defineService,
  defineMiddleware,
  defineModel,
  generateCrudRoutes,
  MemoryStore,
  FrameworkError,
  ErrorCodes,
  getEnvRegistry,
  clearEnvRegistry,       // tests only
} from '@klusterio/kinetic-core';

// Sub-paths
import { wrapSuccess, wrapList, enforcePagination } from '@klusterio/kinetic-core/schema';
import { validateBody, rateLimit, createAuthHook, extractBearerToken } from '@klusterio/kinetic-core/security';
import { createLogger, Metrics, Health } from '@klusterio/kinetic-core/observability';
import { createIntrospectionPlugin } from '@klusterio/kinetic-core/ai-dev';

// Addons
import { JwtAddon }  from '@klusterio/kinetic-addon-jwt';
import { CorsAddon } from '@klusterio/kinetic-addon-cors';
import { KyselyStore } from '@klusterio/kinetic-addon-kysely';
import { OtelAddon } from '@klusterio/kinetic-addon-otel';

// Types
import type { ICrud, AppContext, RequestContext, FastifyRequestWithContexts } from '@klusterio/kinetic-core';
```

---

## 1. Environment variables — `defineEnv`

Call once per module at the **top level** (not inside functions). Validation runs at import time, so missing vars surface at startup.

```typescript
// db/config.ts
import { defineEnv } from '@klusterio/kinetic-core';
import { z } from 'zod';

export const dbEnv = defineEnv('db', {
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().default(10),   // "10" → 10
  DB_SSL:       z.coerce.boolean().default(false), // "true" → true
});
// dbEnv.DATABASE_URL → string, dbEnv.DB_POOL_SIZE → number
```

**Rules:**
- Use `z.coerce.number()` / `z.coerce.boolean()` for non-strings — env values are always strings.
- Use `z.string().optional()` for vars that may be absent.
- The `group` name (first arg) appears in error messages and `/__introspect/env`.
- Groups accumulate across files; each module only declares what it needs.

**In tests:** pass a custom source object; never mutate `process.env`.

```typescript
import { defineEnv, clearEnvRegistry } from '@klusterio/kinetic-core';
beforeEach(() => clearEnvRegistry());

const env = defineEnv('db', { DATABASE_URL: z.string().url() }, {
  DATABASE_URL: 'postgres://localhost/test',
});
```

**Error shape when validation fails:**
```
FrameworkError: {"c":"E_INIT_CFG","s":"db","r":"DATABASE_URL,API_KEY","t":1712345678}
                                                  ^ all failing keys at once
```

---

## 2. Application bootstrap — `createApp`

```typescript
import { createApp } from '@klusterio/kinetic-core';
import { dbEnv } from './db/config.js';
import { KyselyStore } from '@klusterio/kinetic-addon-kysely';

const app = await createApp({
  createAppContext: async () => {
    // Build services in dependency order — explicit, no magic
    const db = new Kysely({ dialect: new PostgresDialect({ connectionString: dbEnv.DATABASE_URL }) });
    const userService = defineService({ store: new KyselyStore(db, 'users') });
    return { db, userService };
  },

  // Optional: per-request context (called on every request)
  createRequestContext: async (req, appCtx) => {
    const token = extractBearerToken(req.headers);
    const user = token ? await appCtx.jwt.verify(token) : null;
    return { user };
  },

  fastifyOptions: { logger: { level: 'info' } },
  gracefulShutdown: true,  // default — registers SIGTERM/SIGINT handlers
  requestLogging: true,    // default — logs request/response via Pino
});

await app.listen({ port: 3000, host: '0.0.0.0' });
```

**`x-request-id`:** Fastify picks up the incoming `x-request-id` header automatically and echoes it on every response. A UUID is generated when the header is absent.

---

## 3. Models — `defineModel`

```typescript
import { defineModel } from '@klusterio/kinetic-core';
import { z } from 'zod';

const UserModel = defineModel({
  name: 'User',             // MUST be PascalCase
  fields: {
    id:        z.string().uuid(),
    email:     z.string().email(),
    name:      z.string().min(1).max(100),
    role:      z.enum(['user', 'admin']).default('user'),
    createdAt: z.date().default(() => new Date()),
  },
  relations: {
    posts: { type: 'hasMany', to: 'Post' },
  },
});

// Derived schemas
UserModel.inputSchema   // fields minus auto-generated (id, createdAt, updatedAt)
UserModel.outputSchema  // all fields
UserModel.getFields()   // FieldInfo[] — for introspection
UserModel.getRelations() // RelationInfo[]
```

**Enforced conventions:**
- Model names → PascalCase (throws `FrameworkError` otherwise)
- Field names → camelCase
- URL paths → auto-generated kebab-case plural: `User` → `/users`

---

## 4. Services — `defineService`

Wraps an `ICrud` store with optional lifecycle hooks. Replaces manual service factory boilerplate.

```typescript
import { defineService, MemoryStore } from '@klusterio/kinetic-core';

const userService = defineService({
  store: new MemoryStore<User>(),   // or KyselyStore, or custom ICrud
  hooks: {
    beforeCreate: async (data) => ({ ...data, createdAt: new Date() }),
    afterCreate:  async (entity) => { await emailService.welcome(entity); return entity; },
    beforeUpdate: async (id, data) => data,
    afterUpdate:  async (entity) => entity,
    beforeDelete: async (id) => { await audit.log('delete', id); },
  },
});

// ICrud interface returned:
await userService.create({ email: 'a@b.com', name: 'Alice' });
await userService.findById(id);
await userService.findAll({ cursor, limit: 20 });
await userService.update(id, { name: 'Alicia' });
await userService.delete(id);
```

**`MemoryStore`** is for development and tests. For production use `KyselyStore` or implement `ICrud` yourself.

### ICrud interface

```typescript
interface ICrud<T, CreateInput = Omit<T, 'id'>, UpdateInput = Partial<T>> {
  create(data: CreateInput): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(options?: { cursor?: string; limit?: number }): Promise<T[]>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}
```

### KyselyStore (PostgreSQL / SQLite)

```typescript
import { KyselyStore } from '@klusterio/kinetic-addon-kysely';
import { Kysely, PostgresDialect } from 'kysely';

const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const userService = defineService({ store: new KyselyStore<User>(db, 'users') });
```

Requires a dialect that supports `RETURNING` (PostgreSQL, SQLite). MySQL users must subclass and override `create`/`update`.

---

## 5. Middleware — `defineMiddleware`

Gives each middleware a name so it appears in stack traces and introspection.

```typescript
import { defineMiddleware } from '@klusterio/kinetic-core';

const requireAuth = defineMiddleware('requireAuth', async (req, reply) => {
  const token = extractBearerToken(req.headers);
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

const adminOnly = defineMiddleware('adminOnly', async (req, reply) => {
  const r = req as FastifyRequestWithContexts<AppCtx, ReqCtx>;
  if (r.requestContext.user?.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden' });
  }
});

// Use in routes
app.delete('/users/:id', { preHandler: [requireAuth.fn, adminOnly.fn] }, handler);
```

---

## 6. Routes

Register routes directly on the Fastify instance. `generateCrudRoutes` covers the standard five CRUD operations.

### Manual routes (recommended for custom logic)

```typescript
import { wrapSuccess, enforcePagination } from '@klusterio/kinetic-core/schema';

const { userService } = app.context;

app.post('/users', async (req) => {
  const user = await userService.create(req.body);
  return wrapSuccess(user);                        // → { data: user }
});

app.get('/users', async (req) => {
  const users = await userService.findAll();
  const { cursor, limit } = req.query as { cursor?: string; limit?: string };
  return enforcePagination(users, {               // → { data: [...], pagination: {...} }
    cursor,
    limit: limit ? parseInt(limit) : 20,
  });
});

app.get('/users/:id', async (req) => {
  const user = await userService.findById(req.params.id);
  if (!user) {
    throw FrameworkError.create(ErrorCodes.E_NF, 'userService', 'not_found');
  }
  return wrapSuccess(user);
});
```

### Auto-generated CRUD routes

```typescript
import { generateCrudRoutes } from '@klusterio/kinetic-core';

const routes = generateCrudRoutes(UserModel, { store: userStore });
// Registers: POST /users, GET /users, GET /users/:id, PUT /users/:id, DELETE /users/:id

routes.forEach(({ method, path, handler, preHandler }) => {
  app[method.toLowerCase()](path, { preHandler: preHandler ?? [] }, handler);
});
```

### Response shapes

```typescript
wrapSuccess(data)           // → { data: T }
wrapList(data, pagination)  // → { data: T[], pagination: { nextCursor?, hasMore, totalCount? } }
enforcePagination(array, options) // slices array + returns ListResponse<T>
```

---

## 7. Error handling

Always use `FrameworkError`. The compact format saves ~30 tokens per error vs verbose alternatives.

```typescript
import { FrameworkError, ErrorCodes } from '@klusterio/kinetic-core';

// Static factory — most concise
throw FrameworkError.create(ErrorCodes.E_NF, 'userService', 'not_found');

// Constructor form — when you need all fields
throw new FrameworkError({
  code: ErrorCodes.E_VAL,
  c: 'E_VAL',
  s: 'userService',
  r: 'email_invalid',
  t: Date.now(),
});
```

### Error codes

| Code | When to use |
|---|---|
| `E_INIT` | App/service failed to start |
| `E_INIT_CONN` | Connection failed at startup |
| `E_INIT_CFG` | Env/config validation failed |
| `E_NF` | Resource not found |
| `E_NF_USER` | User not found specifically |
| `E_NF_RESOURCE` | Generic resource not found |
| `E_VAL` | Input validation failed |
| `E_VAL_EMAIL` | Email validation failed |
| `E_VAL_SCHEMA` | Schema validation failed |
| `E_DB` | Database error |
| `E_DB_TIMEOUT` | Database timeout |
| `E_DB_CONN` | Database connection error |
| `E_AUTH` | Authentication required / failed |
| `E_AUTH_JWT` | JWT verification failed |
| `E_AUTH_PERM` | Insufficient permissions |

Wire format: `{"c":"E_NF","s":"userService","r":"not_found","t":1712345678901}`

---

## 8. Security

```typescript
import { validateBody, rateLimit, createAuthHook, extractBearerToken } from '@klusterio/kinetic-core/security';

// Body validation — throws E_VAL on failure
app.post('/users', {
  preHandler: [validateBody(UserModel.inputSchema)],
}, async (req) => {
  return wrapSuccess(await userService.create(req.body));
});

// Rate limiting
app.post('/login', {
  preHandler: [rateLimit({ max: 5, window: 60 })],  // 5 req / 60 sec
}, handler);

// Auth hook
const authHook = createAuthHook(async (req) => {
  const token = extractBearerToken(req.headers);
  if (!token) return { success: false, error: 'No token' };
  try {
    const claims = await jwtService.verify(token);
    return { success: true, user: { id: claims.sub, ...claims } };
  } catch {
    return { success: false, error: 'Invalid token' };
  }
});
```

---

## 9. Addons

### JWT — `@klusterio/kinetic-addon-jwt`

```typescript
import { JwtAddon } from '@klusterio/kinetic-addon-jwt';

const jwt = await JwtAddon.create({
  secret: jwtEnv.JWT_SECRET,
  expiresIn: '1h',
});

const token = jwt.sign({ sub: user.id, role: user.role });
const claims = jwt.verify(token);   // throws on invalid/expired

// Fastify middleware — sets req.user from Bearer token
await app.register(JwtAddon.middleware({ secret: jwtEnv.JWT_SECRET }));
```

### CORS — `@klusterio/kinetic-addon-cors`

```typescript
import { CorsAddon } from '@klusterio/kinetic-addon-cors';

await app.register(CorsAddon.plugin({
  origin: 'https://app.example.com',  // '*' for public APIs
  credentials: true,
  exposedHeaders: ['x-request-id'],
}));
```

Register before routes. Uses `fastify-plugin` so it applies at app scope, not plugin scope.

### Kysely — `@klusterio/kinetic-addon-kysely`

```typescript
import { KyselyStore } from '@klusterio/kinetic-addon-kysely';

const userService = defineService({
  store: new KyselyStore<User>(db, 'users'),
});
```

### OpenTelemetry — `@klusterio/kinetic-addon-otel`

```typescript
import { OtelAddon } from '@klusterio/kinetic-addon-otel';

const otel = await OtelAddon.create({
  serviceName: 'my-service',
  tracesEndpoint: 'http://otel-collector:4318/v1/traces',
});

const app = await createApp({
  createAppContext: async () => ({ otel }),
});
```

---

## 10. Introspection

All `defineEnv` groups, registered routes, models, and error codes appear in one endpoint. Read this first when working on an existing codebase.

```
GET /__introspect          → full compact manifest (one request, full picture)
GET /__introspect/env      → env groups { required: [], optional: [] }
GET /__introspect/routes   → registered routes
GET /__introspect/schema   → model definitions
GET /__introspect/errors   → recent runtime errors
GET /__introspect/health   → plugin status
```

**Manifest shape:**
```json
{
  "routes":      ["GET /users", "POST /users", "GET /users/:id"],
  "models":      { "User": { "fields": ["id:str","email:str","name:str"], "rel": [] } },
  "errors":      ["E_INIT","E_NF","E_VAL","E_AUTH","E_DB"],
  "conventions": { "url": "kebab", "fields": "camel", "pagination": "cursor" },
  "env": {
    "db":    { "required": ["DATABASE_URL"], "optional": ["DB_POOL_SIZE","DB_SSL"] },
    "jwt":   { "required": ["JWT_SECRET"],   "optional": ["JWT_EXPIRES_IN"] }
  }
}
```

Field type abbreviations: `str`, `num`, `bool`, `date`, `arr`, `obj`. Trailing `?` = optional.

Enable the plugin:
```typescript
import { createIntrospectionPlugin } from '@klusterio/kinetic-core/ai-dev';

const plugin = createIntrospectionPlugin({ routes, models });
await plugin.register(app);   // only registers in NODE_ENV !== 'production' by default
```

---

## 11. Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createApp, defineService, MemoryStore, clearEnvRegistry } from '@klusterio/kinetic-core';

beforeEach(() => clearEnvRegistry()); // reset env registry between tests

describe('User API', () => {
  it('creates a user', async () => {
    const userService = defineService({ store: new MemoryStore() });
    const app = await createApp({
      createAppContext: async () => ({ userService }),
    });

    app.post('/users', async (req) => {
      const user = await userService.create(req.body);
      return wrapSuccess(user);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Alice', email: 'alice@example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.name).toBe('Alice');
  });
});
```

**Key points:**
- Use `app.inject()` for request testing — no server needed
- Use `MemoryStore` in tests, swap to `KyselyStore` (or a real DB) in integration tests
- Call `clearEnvRegistry()` in `beforeEach` if tests call `defineEnv()`
- Set `NODE_ENV=test` so graceful shutdown handlers are not registered

---

## 12. Recommended project structure

```
src/
├── env.ts               # optional: re-export all defineEnv calls for a central view
├── app.ts               # createApp — wires context
├── db/
│   ├── config.ts        # defineEnv('db', {...})
│   └── store.ts         # KyselyStore / ICrud implementation
├── cache/
│   ├── config.ts        # defineEnv('cache', {...})
├── features/
│   ├── users/
│   │   ├── model.ts     # defineModel
│   │   ├── service.ts   # defineService
│   │   └── routes.ts    # app.get/post/etc
│   └── posts/
│       └── ...
└── middleware/
    └── auth.ts          # defineMiddleware
```

---

## 13. Anti-patterns

### ❌ Reading `process.env` directly in services

```typescript
// WRONG — hidden dependency, not registered to manifest
const db = new Pool({ host: process.env.DB_HOST });

// CORRECT
const dbEnv = defineEnv('db', { DB_HOST: z.string() });
const db = new Pool({ host: dbEnv.DB_HOST });
```

### ❌ Verbose error format

```typescript
// WRONG — ~45 tokens
throw new FrameworkError({ code: 'E_NF', message: 'User was not found in the database', suggestion: '...', docsUrl: '' });

// CORRECT — ~14 tokens
throw FrameworkError.create(ErrorCodes.E_NF, 'userService', 'not_found');
```

### ❌ Using non-existent error codes

```typescript
// WRONG — E_NOTFOUND, E_VALID, E_SERVER do not exist
throw new FrameworkError({ c: 'E_NOTFOUND', ... });

// CORRECT — use ErrorCodes enum
throw FrameworkError.create(ErrorCodes.E_NF, 'userService', 'not_found');
```

### ❌ `app.registerRoutes()` — does not exist

```typescript
// WRONG — this method does not exist
app.registerRoutes(routes);

// CORRECT — register on the Fastify instance directly
routes.forEach(r => app[r.method.toLowerCase()](r.path, r.handler));
```

### ❌ Wrong `wrapSuccess` shape

```typescript
// WRONG — wrapSuccess does NOT return { success: true, data: ... }
return { success: true, data: user };

// CORRECT
return wrapSuccess(user);  // → { data: user }
```

### ❌ `z.number()` for env vars

```typescript
// WRONG — env values are strings, z.number() will reject "3000"
PORT: z.number().default(3000)

// CORRECT
PORT: z.coerce.number().default(3000)
```

---

## 14. Zod version note

Kinetic uses **Zod v4**. Use `instanceof` checks (not `constructor.name`) when working with Zod types in framework internals. The public API (`z.string()`, `z.object()`, `z.infer`, etc.) is unchanged from v3.
