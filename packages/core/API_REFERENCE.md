# @klusterio/kinetic-core API Reference

## Core Application

### createApp

Creates a Fastify application with typed application and request contexts.

```typescript
export async function createApp<
  TAppContext extends AppContext,
  TRequestContext extends RequestContext = {}
>(
  options: CreateAppOptions<TAppContext, TRequestContext>
): Promise<FastifyWithContext<TAppContext>>
```

#### CreateAppOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `createAppContext` | `() => Promise<TAppContext>` | ✅ | Factory for app-level context |
| `createRequestContext` | `(req, appCtx) => Promise<TRequestContext>` | ❌ | Factory for per-request context |
| `fastifyOptions` | `FastifyServerOptions` | ❌ | Fastify server options |
| `tracer` | `TracerProvider` | ❌ | Tracer instance (defaults to InMemoryTracer) |

#### FastifyWithContext

Extends FastifyInstance with typed `context` property.

| Property | Type | Description |
|----------|------|-------------|
| `context` | `TAppContext` | Application-level context |

#### FastifyRequestWithContexts

Extends FastifyRequest with typed contexts. Access via `(req as FastifyRequestWithContexts<MyAppContext, MyRequestContext>)`.

| Property | Type | Description |
|----------|------|-------------|
| `requestContext` | `TRequestContext` | Per-request context (NOT `context` - reserved) |
| `appContext` | `TAppContext` | Application-level context reference |

---

## CRUD: generateCrudRoutes

Generates REST API routes for a model using an ICrud store.

```typescript
export function generateCrudRoutes<T extends { id: string }>(
  model: Model,
  config: { store: ICrud<T> },
  options?: CrudOptions
): RouteDefinition[]
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | `Model` | Model definition from `defineModel()` |
| `config.store` | `ICrud<T>` | Store implementing ICrud interface |
| `options` | `CrudOptions` | Optional operation overrides |

### CrudOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `create.enabled` | `boolean` | `true` | Enable POST /resources |
| `read.enabled` | `boolean` | `true` | Enable GET /resources and GET /resources/:id |
| `update.enabled` | `boolean` | `true` | Enable PUT /resources/:id |
| `delete.enabled` | `boolean` | `true` | Enable DELETE /resources/:id |

### Route Registration

> ⚠️ **Important**: Must use URL adapter for Fastify compatibility

```typescript
const routes = generateCrudRoutes(UserModel, { store });
for (const route of routes) {
  app.route({ ...route, url: route.path } as any);
}
```

### Generated Routes

| Method | Path | Operation |
|--------|------|-----------|
| POST | `/users` | Create |
| GET | `/users` | List (with cursor pagination) |
| GET | `/users/:id` | Get by ID |
| PUT | `/users/:id` | Update |
| DELETE | `/users/:id` | Delete |

---

## ICrud Interface

Interface for CRUD operations on any storage backend.

```typescript
interface ICrud<T, CreateInput = Omit<T, 'id'>, UpdateInput = Partial<T>> {
  create(data: CreateInput): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(options?: { cursor?: string; limit?: number }): Promise<T[]>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}
```

### MemoryStore

Built-in ICrud implementation using in-memory Map.

```typescript
export class MemoryStore<T extends { id: string }> implements ICrud<T>
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `create(data)` | `Promise<T>` | Create with auto-generated UUID |
| `findById(id)` | `Promise<T \| null>` | Find by ID |
| `findAll(opts?)` | `Promise<T[]>` | Find with optional cursor/limit |
| `update(id, data)` | `Promise<T>` | Update entity |
| `delete(id)` | `Promise<void>` | Delete entity |
| `clear()` | `void` | Clear all data |
| `size()` | `number` | Get entry count |

---

## Model Definition

### defineModel

Defines a data model with Zod validation.

```typescript
export function defineModel(definition: ModelDefinition): Model
```

#### ModelDefinition

```typescript
{
  name: string;           // PascalCase model name
  fields: Record<string, z.ZodType>;  // Field definitions
  relations?: Record<string, RelationDefinition>;  // Optional relations
}
```

#### Field Types

Common Zod types for fields:

```typescript
import { z } from 'zod';

const User = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1),
    age: z.number().int().min(0).optional(),
    tags: z.array(z.string()),
    metadata: z.record(z.unknown()),
  },
});
```

#### Model Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Model name (PascalCase) |
| `inputSchema` | `ZodObject` | Schema excluding auto-generated fields |
| `outputSchema` | `ZodObject` | Full schema including all fields |
| `getFields()` | `FieldInfo[]` | Get field metadata |
| `getRelations()` | `RelationInfo[]` | Get relation definitions |

---

## Error Handling

### FrameworkError

Condensed error format optimized for AI token efficiency.

```typescript
export class FrameworkError extends Error {
  readonly code: string;
  readonly service: string;
  readonly reason: string;
  readonly timestamp: number;

  toJSON(): CondensedError;
  static create(code, service, reason): FrameworkError;
}
```

### Error Codes

| Code | Format | Meaning |
|------|--------|---------|
| `E_INIT` | Initialization | General initialization failure |
| `E_INIT_CONN` | Initialization | Connection failed |
| `E_INIT_CFG` | Initialization | Configuration error |
| `E_NF` | Not Found | Resource not found |
| `E_NF_USER` | Not Found | User not found |
| `E_VAL` | Validation | Validation failed |
| `E_VAL_EMAIL` | Validation | Email validation failed |
| `E_VAL_SCHEMA` | Validation | Schema validation failed |
| `E_DB` | Database | General database error |
| `E_DB_TIMEOUT` | Database | Database timeout |
| `E_AUTH` | Authentication | Authentication failed |
| `E_AUTH_JWT` | Authentication | JWT validation failed |
| `E_AUTH_PERM` | Authentication | Permission denied |

### Usage

```typescript
throw new FrameworkError({
  c: 'E_INIT',
  s: 'userService',
  r: 'conn_refus',
  t: Date.now(),
});
// → {"c":"E_INIT","s":"userService","r":"conn_refus","t":1234567890}
```

---

## Tracing

### InMemoryTracer

Built-in tracer with automatic log rotation.

```typescript
export class InMemoryTracer implements TracerProvider {
  startSpan(name: string, options?: { parentId?: string }): Span;
  getLogs(): TraceEntry[];
  getRecent(limit?: number): TraceEntry[];
  clear(): void;
}
```

#### TraceEntry

```typescript
{
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  parentId?: string;
  attributes: Record<string, unknown>;
}
```

### registerTraceEndpoint

Registers debug endpoint at `/__debug/traces`.

```typescript
export function registerTraceEndpoint(
  fastify: FastifyInstance,
  tracer: InMemoryTracer
): void
```

---

## Security Middleware

### validateBody

Validates request body against Zod schema.

```typescript
export function validateBody(schema: z.ZodType): ValidationMiddleware
```

**Throws**: `FrameworkError` with code `E_VAL` on validation failure.

### rateLimit

Rate limiting middleware using sliding window.

```typescript
export function rateLimit(options: RateLimitOptions): RateLimitMiddleware
```

#### RateLimitOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `max` | `number` | (required) | Maximum requests allowed |
| `window` | `number` | (required) | Time window in seconds |
| `key` | `(req) => string` | IP address | Custom rate limit key |

**Throws**: `FrameworkError` with code `E_VAL` when limit exceeded.

### extractBearerToken

Parses Bearer token from Authorization header.

```typescript
export function extractBearerToken(
  headers: { authorization?: string }
): string | null
```

---

## Introspection

### registerSecureIntrospection

Registers dev-only introspection endpoints with security gating.

```typescript
export function registerSecureIntrospection(
  fastify: FastifyInstance,
  options: IntrospectionRouteOptions & IntrospectionConfig
): void
```

### IntrospectionConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | `NODE_ENV === 'development'` | Enable introspection |
| `allowInProduction` | `boolean` | `false` | Allow in production (with warning) |

### Available Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /__introspect/routes` | All registered routes |
| `GET /__introspect/schema` | All defined model schemas |
| `GET /__introspect/conventions` | Framework conventions |
| `GET /__introspect/errors` | Recent error log |
| `GET /__introspect/health` | Health check |

---

## Configuration

### loadConfig

Loads configuration from environment variables.

```typescript
export function loadConfig(options: {
  env?: Record<string, string>;
  defaults?: Partial<AppConfig>;
}): AppConfig
```

### Environment Variable Mapping

| Variable | Type | Maps To |
|----------|------|---------|
| `PORT` | number | `server.port` |
| `APP_NAME` | string | `name` |
| `DATABASE_HOST` | string | `database.host` |
| `DATABASE_PORT` | number | `database.port` |
| `DATABASE_SSL` | boolean | `database.ssl` |
| `JWT_SECRET` | string | `security.jwtSecret` |
| `JWT_EXPIRES_IN` | string | `security.jwtExpiresIn` |
| `RATE_LIMIT_MAX` | number | `security.rateLimitMax` |
| `LOG_LEVEL` | enum | `logging.level` |
| `LOG_FORMAT` | enum | `logging.format` |

---

## JWT Addon

### JwtAddon

Factory pattern authentication addon.

```typescript
export const JwtAddon = {
  async create(config: JwtConfig): Promise<JwtService>;
  middleware(config: JwtConfig): (fastify) => Promise<void>;
}
```

### Usage

```typescript
import { JwtAddon } from '@klusterio/jwt-addon';

const jwt = await JwtAddon.create({ secret: process.env.JWT_SECRET });

const app = await createApp<{ jwt: JwtService }>({
  createAppContext: async () => ({ jwt }),
});

// Apply middleware
await jwt.middleware(app);

// Creates onRequest hook that sets req.user from JWT
```

---

## Common Type Aliases

```typescript
type AppContext = Record<string, unknown>;
type RequestContext = Record<string, unknown>;
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RouteHandler = (request: Request, reply: Reply) => Promise<unknown> | unknown;
```

---

**Full examples in README.md**
