# Kinetic

AI-optimized Fastify framework for building consistent, type-safe backend APIs.

Designed to minimise the token cost of AI-assisted development: compact error formats, per-module env validation, a single introspection endpoint, and convention-enforcing helpers that eliminate repetitive boilerplate.

---

## Packages

| Package | Description |
|---|---|
| `@klusterio/kinetic-core` | Framework core — app bootstrap, models, CRUD, security, env, introspection |
| `@klusterio/addon-jwt` | JWT sign / verify / middleware |
| `@klusterio/addon-cors` | CORS via `@fastify/cors` |
| `@klusterio/addon-kysely` | `ICrud` adapter for Kysely |
| `@klusterio/addon-otel` | OpenTelemetry distributed tracing |

---

## Quick Start

```typescript
import { createApp, defineModel, defineService, defineEnv, MemoryStore } from '@klusterio/kinetic-core';
import { wrapSuccess, enforcePagination } from '@klusterio/kinetic-core/schema';
import { z } from 'zod';

// 1. Declare env vars — validated at startup, registered to /__introspect
const env = defineEnv('server', {
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
});

// 2. Define models
const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  },
});

// 3. Bootstrap
const app = await createApp({
  createAppContext: async () => {
    const userService = defineService({ store: new MemoryStore() });
    return { userService };
  },
  fastifyOptions: { logger: true },
});

// 4. Routes
app.get('/users', async (req) => {
  const users = await app.context.userService.findAll();
  return enforcePagination(users, { limit: 20 });
});

await app.listen({ port: env.PORT, host: env.HOST });
```

---

## Development

```bash
pnpm install     # install all workspace dependencies
pnpm build       # build all packages
pnpm test        # run all tests
pnpm typecheck   # TypeScript check without emit
pnpm dev         # watch mode
```

---

## Features

### `createApp(options)` — Application bootstrap

Wraps Fastify with typed app-level and per-request contexts.

- `x-request-id` propagation (honours incoming header, generates UUID fallback)
- Structured request/response logging via Fastify's Pino instance
- Graceful shutdown on `SIGTERM`/`SIGINT` (skipped in `NODE_ENV=test`)

```typescript
const app = await createApp({
  createAppContext: async () => ({ db }),
  createRequestContext: async (req, ctx) => ({ user: await ctx.db.getUser(req.id) }),
  fastifyOptions: { logger: { level: 'info' } },
  gracefulShutdown: true,   // default
  requestLogging: true,     // default
});
```

---

### `defineEnv(group, schema)` — Environment variable validation

Validates env vars at module load time. Throws a single `FrameworkError` listing every failing key. Registers each group to the `/__introspect` manifest so AI tools can discover all requirements in one request.

```typescript
// db/config.ts — each module owns its slice
export const dbEnv = defineEnv('db', {
  DATABASE_URL: z.string().url(),
  DB_POOL_SIZE: z.coerce.number().default(10),
});

// cache/config.ts
export const cacheEnv = defineEnv('cache', {
  REDIS_URL: z.string().url(),
  REDIS_TTL: z.coerce.number().default(3600),
});
```

Use `z.coerce.number()` / `z.coerce.boolean()` for non-string types since all env values are strings at runtime.

---

### `defineModel(definition)` — Data model definition

Enforces `PascalCase` model names and `camelCase` field names. Powers `generateCrudRoutes()` and model introspection.

```typescript
const PostModel = defineModel({
  name: 'Post',
  fields: {
    id: z.string().uuid(),
    title: z.string().min(1).max(200),
    published: z.boolean().default(false),
    authorId: z.string(),
  },
  relations: {
    author: { type: 'belongsTo', to: 'User', foreignKey: 'authorId' },
  },
});
```

---

### `defineService(config)` — Service factory with lifecycle hooks

Wraps any `ICrud` store with optional `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete` hooks — replacing repetitive service boilerplate.

```typescript
const userService = defineService({
  store: new MemoryStore(),
  hooks: {
    beforeCreate: async (data) => ({ ...data, createdAt: new Date() }),
    beforeDelete: async (id) => { await audit.log('delete', id); },
  },
});
```

---

### `defineMiddleware(name, fn)` — Named Fastify preHandlers

Gives each middleware a name for introspection and readable stack traces.

```typescript
const requireAuth = defineMiddleware('requireAuth', async (req, reply) => {
  if (!req.headers.authorization) reply.code(401).send({ error: 'Unauthorized' });
});

app.get('/protected', { preHandler: [requireAuth.fn] }, handler);
```

---

### `generateCrudRoutes(model, config)` — Auto-generated CRUD routes

Generates `POST /resources`, `GET /resources`, `GET /resources/:id`, `PUT /resources/:id`, `DELETE /resources/:id` from a model and `ICrud` store.

```typescript
const routes = generateCrudRoutes(UserModel, { store: userStore });
routes.forEach(({ method, path, handler }) => app[method.toLowerCase()](path, handler));
```

---

### Introspection — `GET /__introspect`

Single endpoint returning a compact manifest of the full app surface. Designed for AI tooling to load application context in one request.

```json
{
  "routes":      ["GET /users", "POST /users", "GET /users/:id"],
  "models":      { "User": { "fields": ["id:str", "email:str", "name:str"], "rel": [] } },
  "errors":      ["E_INIT", "E_NF", "E_VAL", "E_AUTH", "E_DB"],
  "conventions": { "url": "kebab", "fields": "camel", "pagination": "cursor" },
  "env": {
    "db":    { "required": ["DATABASE_URL"], "optional": ["DB_POOL_SIZE"] },
    "cache": { "required": ["REDIS_URL"],    "optional": ["REDIS_TTL"] }
  }
}
```

Verbose sub-endpoints: `/__introspect/routes`, `/schema`, `/conventions`, `/errors`, `/env`, `/health`.

---

### Error format

All framework errors use a compact token-efficient format (~14 tokens vs ~45 for verbose):

```
{"c":"E_NF","s":"userService","r":"not_found","t":1712345678901}
```

| Field | Meaning |
|---|---|
| `c` | Error code (`E_NF`, `E_VAL`, `E_AUTH`, `E_DB`, `E_INIT`) |
| `s` | Service / subject |
| `r` | Reason (≤ 20 chars) |
| `t` | Unix timestamp (ms) |

---

## Addons

### `@klusterio/addon-jwt`

```typescript
import { JwtAddon } from '@klusterio/addon-jwt';

const jwt = await JwtAddon.create({ secret: process.env.JWT_SECRET });
const token = jwt.sign({ sub: user.id });
const claims = jwt.verify(token);

// Fastify middleware
await app.register(JwtAddon.middleware({ secret: process.env.JWT_SECRET }));
```

### `@klusterio/addon-cors`

```typescript
import { CorsAddon } from '@klusterio/addon-cors';

await app.register(CorsAddon.plugin({
  origin: 'https://app.example.com',
  credentials: true,
  exposedHeaders: ['x-request-id'],
}));
```

### `@klusterio/addon-kysely`

`KyselyStore<T>` implements `ICrud<T>` for PostgreSQL and SQLite (dialects that support `RETURNING`).

```typescript
import { KyselyStore } from '@klusterio/addon-kysely';
import { Kysely, PostgresDialect } from 'kysely';

const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const userService = defineService({ store: new KyselyStore<User>(db, 'users') });
```

---

## Test counts

| Package | Tests |
|---|---|
| `@klusterio/kinetic-core` | 145 |
| `@klusterio/addon-jwt` | 8 |
| `@klusterio/addon-cors` | 6 |
| `@klusterio/addon-kysely` | 11 |
| **Total** | **170** |
