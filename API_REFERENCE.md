# Kinetic Framework API Reference

## Overview

This document describes the API for the Kinetic AI-Optimized Fastify Framework. It is designed for AI consumption - minimal, explicit, and fully typed.

---

## Core Package: `@klusterio/core`

### Service Container

The service container provides **compile-time safe dependency injection** using TypeScript's type system. Dependencies are declared via destructuring, not string keys, eliminating hallucination risks.

#### `createContainer<Services>(definition: ServiceDefinition<Services>): Container<Services>`

Creates a typed service container with automatic dependency resolution.

**Interface**:
```typescript
type ServiceFactory<T> = () => Promise<T> | T;
type ServiceFactoryWithDeps<T, Deps> = (deps: Deps) => Promise<T> | T;

type ServiceDefinition<T> = {
  scope?: 'singleton' | 'request' | 'transient'; // default: 'singleton'
  factory: ServiceFactory<T> | ServiceFactoryWithDeps<T, any>;
} | ServiceFactory<T> | ServiceFactoryWithDeps<T, any>;

// Simplified form - just provide factory function
const container = createContainer({
  db: async () => {
    const db = new Database(config);
    await db.connect();
    return db;
  },

  // Dependencies injected via destructuring
  userStore: async ({ db }) => {
    return new UserStore(db);
  },

  // Multiple dependencies
  orderService: async ({ db, userStore }) => {
    return new OrderService(db, userStore);
  },
});
```

**Example**:
```typescript
import { createContainer } from '@klusterio/core';

// AI fills in service factories
// Dependencies are type-checked at compile time
const container = createContainer({
  // Infrastructure services
  db: async () => {
    const db = new Database({
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
    });
    await db.connect();
    return db;
  },

  cache: async () => {
    return new RedisCache(process.env.REDIS_URL);
  },

  // Domain services with dependencies
  userStore: async ({ db }) => {
    return new UserStore(db);
  },

  orderService: async ({ db, userStore, cache }) => {
    return new OrderService(db, userStore, cache);
  },

  // No dependencies
  logger: async () => {
    return new Logger({ level: 'info' });
  },
});

// Validate dependency graph before initialization
const validation = container.validate();
// Returns:
// {
//   success: true,
//   resolvedOrder: ['db', 'cache', 'logger', 'userStore', 'orderService'],
//   dependencies: {
//     userStore: ['db'],
//     orderService: ['db', 'userStore', 'cache']
//   }
// }

// Initialize in dependency order
const services = await container.initialize();
// services.db, services.userStore, services.orderService all typed

// Access individual service
const userStore = container.get('userStore'); // Typed as UserStore
```

**Compile-Time Safety**:
```typescript
// ❌ TypeScript ERROR: Property 'databse' does not exist (typo)
userStore: async ({ databse }) => new UserStore(databse)

// ❌ TypeScript ERROR: 'unregisteredService' not in container
orderService: async ({ unregisteredService }) => ...
```

---

#### `container.validate(): ValidationReport`

Validates the service dependency graph before initializing.

**Returns**:
```typescript
interface ValidationSuccess {
  success: true;
  resolvedOrder: string[];           // Initialization order
  dependencies: Record<string, string[]>; // Service dependency map
  services: ServiceInfo[];
}

interface ValidationFailure {
  success: false;
  error: {
    type: 'CYCLIC_DEPENDENCY' | 'UNDEFINED_DEPENDENCY' | 'INVALID_SCOPE';
    service?: string;
    dependency?: string;
    cycle?: string[];
    suggestion: string;
    docsUrl: string;
  };
}

type ValidationReport = ValidationSuccess | ValidationFailure;
```

**Example**:
```typescript
const validation = container.validate();

if (!validation.success) {
  // AI gets clear guidance
  console.error(validation.error.suggestion);
  // "Service 'orderService' depends on 'databse' which is not defined.
  // Did you mean: db? Available services: ['db', 'cache', 'logger']"
  process.exit(1);
}
```

**Cyclic Dependency Detection**:
```typescript
const badContainer = createContainer({
  a: async ({ b }) => new ServiceA(b),
  b: async ({ a }) => new ServiceB(a), // Cycle!
});

const result = badContainer.validate();
// {
//   success: false,
//   error: {
//     type: 'CYCLIC_DEPENDENCY',
//     cycle: ['a', 'b', 'a'],
//     suggestion: 'Services a and b depend on each other...',
//     docsUrl: 'https://docs.kluster.dev/errors/CYCLIC_DEPENDENCY'
//   }
// }
```

---

#### `container.initialize(): Promise<Services>`

Initializes all services in dependency order.

**Example**:
```typescript
try {
  const services = await container.initialize();

  // All services ready
  await services.orderService.processOrder('123');
  services.logger.info('Order processed');
} catch (err) {
  // Initialization failure with AI guidance
  // {
  //   code: 'INIT_FAILURE',
  //   service: 'db',
  //   suggestion: 'Database connection failed...',
  //   originalError: Error
  // }
}
```

---

#### `container.get<K extends keyof Services>(key: K): Services[K]`

Retrieves an initialized service by name.

**Preconditions**: Container must be initialized.

**Example**:
```typescript
const db = container.get('db');        // Typed as Database
const store = container.get('userStore'); // Typed as UserStore
```

---

#### `container.introspect(): ContainerIntrospection`

Returns full container state for AI debugging.

**Returns**:
```typescript
{
  services: [
    {
      name: 'db',
      scope: 'singleton',
      status: 'initialized' | 'uninitialized' | 'error',
      dependencies: [],
      dependents: ['userStore', 'orderService'],
    },
    {
      name: 'userStore',
      scope: 'singleton',
      status: 'initialized',
      dependencies: ['db'],
      dependents: ['orderService'],
    },
  ],
  resolvedOrder: ['db', 'cache', 'userStore', 'orderService'],
  cycles: [],
  errors: [],
}
```

---

### Application Bootstrap

#### `createApp(options: AppOptions)`

Creates and configures the Fastify application.

**Interface**:
```typescript
interface AppOptions<Services> {
  container: Container<Services>;
  addons?: Addon[];
  config: AppConfig;
}

interface AppConfig {
  port: number;
  host?: string;
  env?: 'development' | 'production' | 'test';
  kluster?: {
    auditEndpoint?: string;
    traceEndpoint?: string;
  };
  // Framework consistency enforcement (AI cannot override per-route)
  conventions?: {
    naming?: {
      urls?: 'kebab-case';           // Always kebab-case: /order-items
      jsonFields?: 'camelCase';      // Always camelCase: firstName
      queryParams?: 'camelCase';     // Always camelCase: pageSize
    };
    pagination?: {
      strategy?: 'cursor';            // Only cursor-based (not offset)
      defaultLimit?: number;         // Default: 20
      maxLimit?: number;             // Default: 100
    };
    responses?: {
      envelope?: boolean;              // Always wrap in { data: ... }
    };
  };
}
```

**Example**:
```typescript
import { createApp, createContainer } from '@klusterio/core';
import { jwtAddon } from '@klusterio/addon-jwt';

const container = createContainer({
  db: async () => new Database(),
  userStore: async ({ db }) => new UserStore(db),
});

const app = await createApp({
  container,
  addons: [jwtAddon({ secret: process.env.JWT_SECRET })],
  config: {
    port: 3000,
    env: 'production',
    kluster: {
      auditEndpoint: process.env.KLUSTER_AUDIT_URL,
    },
  },
});
```

---

#### `app.start(): Promise<void>`

Starts the server. Automatically initializes container if not already done.

#### `app.stop(): Promise<void>`

Graceful shutdown.

#### `app.registerRoutes(routes: RouteDefinition[])`

Registers multiple routes.

**Example**:
```typescript
app.registerRoutes([
  { method: 'GET', path: '/users', handler: listUsers },
  { method: 'POST', path: '/users', handler: createUser, middleware: [auth] },
]);
```

---

## Advanced AppContext Features

### Scope Management

```typescript
const container = createContainer({
  // Singleton (default) - initialized once, shared across app
  db: {
    scope: 'singleton',
    factory: async () => new Database(),
  },

  // Request-scoped - new instance per HTTP request
  requestLogger: {
    scope: 'request',
    factory: async ({ db }) => new RequestLogger(db),
  },

  // Transient - new instance every time
  tempCalculator: {
    scope: 'transient',
    factory: async () => new Calculator(),
  },
});
```

### Testing with Mock Services

```typescript
// Test container with mocks
const testContainer = createContainer({
  db: async () => new MockDatabase(),
  userStore: async ({ db }) => new UserStore(db),
});

const services = await testContainer.initialize();
// userStore now uses mock database
```

---

## Core Package Exports

`@klusterio/core` includes the following submodules for organizational purposes:

```typescript
// Main exports
import { createApp, createContainer } from '@klusterio/core';

// Schema (naming conventions, validation)
import { defineModel, generateCrudRoutes } from '@klusterio/core/schema';

// Config (typed configuration)
import { loadConfig } from '@klusterio/core/config';

// Security (hooks, rate limiting)
import { rateLimit, validateBody } from '@klusterio/core/security';

// Observability (logging, tracing)
import { logger, initTracing } from '@klusterio/core/observability';
```

**Note**: Schema, config, and conventions are **core features**, not separate packages. They cannot be used independently.

---

## Schema Module: `@klusterio/core/schema`

### Naming Conventions

The enforces naming conventions automatically - AI cannot deviate:

| Aspect | Convention | AI Must | Framework Enforces |
|--------|-----------|---------|------------------|
| **Field Names** | camelCase | `firstName`, `profilePicture` | Converts database fields |
| **URLs** | kebab-case | Model name only | `OrderItem` → `/order-items` |
| **Query Params** | camelCase | Standard params | `pageSize` not `page_size` |
| **Response Fields** | camelCase | Standard fields | Auto-converts |

### Pagination Standards

**Framework enforces cursor-based pagination automatically:**
- AI cannot skip pagination on list endpoints
- AI cannot customize pagination strategy
- Query params: `?cursor=xxx&limit=20&sort=-createdAt`
- Response wrapper: `{ data: [...], pagination: { nextCursor, hasMore } }`


### Model Definition

#### `defineModel(definition: ModelDefinition): Model`

Defines a data model (single source of truth).

**Interface**:
```typescript
interface ModelDefinition {
  name: string;  // Framework converts to plural kebab-case URL
  fields: Record<string, z.ZodType<any>>;  // camelCase, framework enforces
  relations?: Record<string, RelationDefinition>;
}

interface RelationDefinition {
  type: 'hasOne' | 'hasMany' | 'belongsTo';
  to: string;
  foreignKey?: string;
}
```

**Example**:
```typescript
import { defineModel } from '@klusterio/schema';
import { z } from 'zod';

const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1).max(255),
    age: z.number().int().min(0).optional(),
    createdAt: z.date().default(() => new Date()),
  },
  relations: {
    posts: { type: 'hasMany', to: 'Post' },
  },
});
```

---

### Model Methods

#### `model.getSchema(): z.ZodObject`

Returns complete Zod schema.

#### `model.getFields(): FieldInfo[]`

Introspection: Returns field metadata.

**Returns**:
```typescript
[
  { name: 'id', type: 'string', required: true, zodType: 'ZodString' },
  { name: 'email', type: 'string', required: true },
  { name: 'age', type: 'number', required: false },
]
```

**Naming Convention Enforcement**:
- AI must use camelCase for field names: `firstName`, `profilePicture`
- Framework automatically converts database fields if using snake_case
- AI cannot use: underscores, hyphens, or PascalCase in field names
```

#### `model.getRelations(): RelationInfo[]`

Returns relation metadata.

#### `model.inputSchema`

Zod schema for create/update operations (excludes id, timestamps).

#### `model.outputSchema`

Zod schema for responses (full model).

---

### CRUD Route Generation

#### `generateCrudRoutes(model: Model, options?: CrudOptions): RouteDefinition[]`

Auto-generates REST routes from model.

**Interface**:
```typescript
interface CrudOptions {
  create?: { enabled: boolean; middleware?: Middleware[] };
  read?: { enabled: boolean; middleware?: Middleware[]; pagination?: boolean };
  update?: { enabled: boolean; middleware?: Middleware[] };
  delete?: { enabled: boolean; middleware?: Middleware[] };
}
```

**Generated Routes** (automatic naming convention):
- `POST   /users`           - Create (201)
- `GET    /users`           - List with **automatic pagination** (200)
- `GET    /users/:id`       - Get by ID (200)
- `PUT    /users/:id`       - Update (200)
- `DELETE /users/:id`       - Delete (204)

**Naming Conventions (Automatic)**:
| Source | Generated URL | Rule |
|--------|---------------|------|
| `name: 'User'` | `/users` | Pluralized, lowercase |
| `name: 'OrderItem'` | `/order-items` | Converted to kebab-case |

**Pagination (Automatic)**:
- Strategy: Cursor-based (framework default)
- Query params: `?cursor=xxx&limit=20`
- Response includes: `{ data: [...], pagination: { nextCursor, hasMore } }`
- **No custom pagination**: AI cannot skip or customize

**Example**:
```typescript
import { generateCrudRoutes } from '@klusterio/schema';

const routes = generateCrudRoutes(UserModel, {
  create: { enabled: true, middleware: [auth] },
  read: { enabled: true, pagination: true },
  update: { enabled: true, middleware: [auth] },
  delete: { enabled: true, middleware: [adminOnly] },
});

app.registerRoutes(routes);
```

---

## Security Package: `@klusterio/security`

### Hooks

#### `registerAuthHook(hook: AuthHook)`

Registers authentication hook.

**Interface**:
```typescript
type AuthHook = async (request: FastifyRequest, reply: FastifyReply) => Promise<AuthResult>;

interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}
```

#### `registerAuthzHook(hook: AuthzHook)`

Registers authorization hook.

**Interface**:
```typescript
type AuthzHook = async (
  request: FastifyRequest,
  reply: FastifyReply,
  policy: Policy
) => Promise<AuthzResult>;

interface Policy {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete';
}
```

---

### Middleware

#### `validateBody(schema: z.ZodType)`

Request body validation middleware.

**Example**:
```typescript
import { validateBody } from '@klusterio/security';

app.post('/users', {
  preHandler: [validateBody(UserModel.inputSchema)],
  handler: async (req, res) => {
    // req.body is validated and typed
  },
});
```

#### `rateLimit(options?: RateLimitOptions)`

Rate limiting middleware.

**Interface**:
```typescript
interface RateLimitOptions {
  max: number;      // requests
  window: number;   // seconds
  key?: (req) => string; // rate limit key generator
}
```

**Example**:
```typescript
import { rateLimit } from '@klusterio/security';

app.registerRoutes([
  {
    method: 'POST',
    path: '/login',
    preHandler: [rateLimit({ max: 5, window: 60 })], // 5 per minute
    handler: loginHandler,
  },
]);
```

---

## Observability Package: `@klusterio/observability`

### OpenTelemetry

#### `initTracing(options: TracingOptions)`

Initializes OpenTelemetry.

**Interface**:
```typescript
interface TracingOptions {
  serviceName: string;
  endpoint?: string; // OTLP endpoint
  exporter?: 'otlp' | 'console';
}
```

**Example**:
```typescript
import { initTracing } from '@klusterio/observability';

initTracing({
  serviceName: 'user-service',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
```

#### `tracer.startSpan(name: string, options?: SpanOptions): Span`

Creates custom span.

**Example**:
```typescript
import { tracer } from '@klusterio/observability';

const span = tracer.startSpan('process-payment', {
  attributes: { 'payment.id': paymentId },
});

try {
  await processPayment(paymentId);
  span.setStatus({ code: SpanStatusCode.OK });
} catch (err) {
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  throw err;
} finally {
  span.end();
}
```

---

### Logging

#### `logger.child(bindings: Record<string, any>): Logger`

Creates child logger with context.

**Example**:
```typescript
import { logger } from '@klusterio/observability';

const requestLogger = logger.child({ requestId: 'abc-123' });
requestLogger.info('Processing request');
requestLogger.error({ err }, 'Request failed');
```

**Output** (JSON):
```json
{"level":30,"time":1234567890,"requestId":"abc-123","msg":"Processing request","traceId":"xyz-789"}
```

---

### Health Endpoints

#### `healthPlugin`

Built-in health check plugin.

**Registers**:
- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe

**Example**:
```typescript
import { healthPlugin } from '@klusterio/observability';

app.register(healthPlugin, {
  checks: {
    database: async () => {
      await db.ping();
      return { status: 'up' };
    },
  },
});
```

---

## AI Developer Package: `@klusterio/ai-dev`

### Introspection Endpoints

Automatically registered when `env.NODE_ENV === 'development'`.

#### `GET /__introspect/container`

Returns service container state including dependencies.

**Response**:
```json
{
  "services": [
    {
      "name": "db",
      "scope": "singleton",
      "status": "initialized",
      "dependencies": [],
      "dependents": ["userStore", "orderService"]
    },
    {
      "name": "userStore",
      "scope": "singleton",
      "status": "initialized",
      "dependencies": ["db"],
      "dependents": ["orderService"]
    }
  ],
  "resolvedOrder": ["db", "userStore", "orderService"],
  "validation": { "success": true }
}
```

#### `GET /__introspect/routes`

Returns all registered routes.

**Response**:
```json
{
  "routes": [
    {
      "method": "GET",
      "path": "/users",
      "handler": "listUsers",
      "schema": { "querystring": { "page": { "type": "number" } } }
    },
    {
      "method": "POST",
      "path": "/users",
      "handler": "createUser",
      "middleware": ["auth"]
    }
  ]
}
```

#### `GET /__introspect/schema`

Returns all defined models.

**Response**:
```json
{
  "models": [
    {
      "name": "User",
      "fields": [
        { "name": "id", "type": "string", "required": true },
        { "name": "email", "type": "string", "required": true }
      ],
      "relations": [{ "name": "posts", "type": "hasMany", "to": "Post" }]
    }
  ]
}
```

#### `GET /__introspect/errors`

Returns recent errors with guidance.

**Response**:
```json
{
  "errors": [
    {
      "timestamp": "2026-03-26T10:00:00Z",
      "code": "VALIDATION_ERROR",
      "message": "Invalid email format",
      "field": "email",
      "suggestion": "Ensure email follows format: user@domain.com",
      "docsUrl": "https://docs.kluster.dev/errors/VALIDATION_ERROR"
    }
  ]
}
```

---

### Error Types

#### Framework Errors

All errors follow this structure:

```typescript
interface FrameworkError {
  code: string;           // Machine-readable error code
  message: string;          // Human-readable message
  suggestion?: string;    // AI-actionable guidance
  docsUrl?: string;       // Link to documentation
  field?: string;         // Field name (validation errors)
  stack?: string;         // Stack trace (development only)
}
```

**Common Error Codes**:
- `VALIDATION_ERROR` - Schema validation failed
- `CYCLIC_DEPENDENCY` - Circular dependency detected
- `UNDEFINED_DEPENDENCY` - Service depends on undefined service
- `INIT_FAILURE` - Service initialization failed
- `AUTHORIZATION_DENIED` - Permission denied
- `RATE_LIMIT_EXCEEDED` - Rate limit hit
- `CONFIG_ERROR` - Invalid configuration

---

## Add-On Development

### Creating an Add-On

#### `defineAddon(definition: AddonDefinition): Addon`

Defines an add-on package that self-registers with the container.

**Interface**:
```typescript
interface AddonDefinition<Services = unknown> {
  name: string;
  version: string;
  install: (app: App, options: unknown) => Promise<void>;
  services?: ServiceDefinitions;
  hooks?: HookDefinitions;
  intents?: IntentTemplates;
}
```

**Example JWT Add-On**:
```typescript
import { defineAddon } from '@klusterio/core';

export const jwtAddon = defineAddon({
  name: '@klusterio/addon-jwt',
  version: '1.0.0',

  install: async (app, options) => {
    // Access container to add JWT service
    const container = app.container;

    // Addons can register additional services
    container.register('jwt', async () => {
      return new JWTService(options);
    });

    // Register auth hook
    app.registerAuthHook(async (request, reply) => {
      const jwt = await container.get('jwt');
      const token = extractBearerToken(request);
      if (!token) return { success: false };

      const user = await jwt.verify(token);
      request.user = user;
      return { success: true, user };
    });
  },

  intents: [
    {
      pattern: 'authenticate with JWT',
      template: `jwtAddon({ secret: process.env.JWT_SECRET })`,
    },
  ],
});
```

---

## Complete Example

### Building a Todo API (V2 Pattern)

```typescript
import { createApp, createContainer } from '@klusterio/core';
import { defineModel, generateCrudRoutes } from '@klusterio/schema';
import { rateLimit } from '@klusterio/security';
import { healthPlugin, initTracing } from '@klusterio/observability';
import { jwtAddon } from '@klusterio/addon-jwt';
import { z } from 'zod';

// 1. Define models
const TodoModel = defineModel({
  name: 'Todo',
  fields: {
    id: z.string().uuid(),
    title: z.string().min(1).max(255),
    completed: z.boolean().default(false),
    createdAt: z.date().default(() => new Date()),
  },
});

// 2. Create typed container with services
const container = createContainer({
  // Infrastructure (no dependencies)
  db: async () => {
    const db = new Database(process.env.DATABASE_URL);
    await db.connect();
    return db;
  },

  logger: async () => new Logger({ level: 'info' }),

  // Domain services (dependencies via destructuring)
  todoStore: async ({ db, logger }) => {
    logger.info('Initializing todo store');
    return new TodoStore(db);
  },

  todoService: async ({ todoStore, logger }) => {
    return new TodoService(todoStore, logger);
  },
});

// 3. Validate before starting (fail fast)
const validation = container.validate();
if (!validation.success) {
  console.error('Container validation failed:', validation.error.suggestion);
  process.exit(1);
}

console.log('Service initialization order:', validation.resolvedOrder);
// ['db', 'logger', 'todoStore', 'todoService']

// 4. Initialize observability
initTracing({ serviceName: 'todo-service' });

// 5. Create app with container
const app = await createApp({
  container,
  addons: [
    jwtAddon({ secret: process.env.JWT_SECRET }),
  ],
  config: {
    port: 3000,
    env: 'production',
    kluster: {
      auditEndpoint: process.env.KLUSTER_AUDIT_URL,
    },
  },
});

// 6. Generate routes
const todoRoutes = generateCrudRoutes(TodoModel, {
  create: { enabled: true, middleware: [rateLimit({ max: 100, window: 60 })] },
  read: { enabled: true, pagination: true },
  update: { enabled: true },
  delete: { enabled: true },
});

// 7. Register routes and plugins
app.registerRoutes(todoRoutes);
app.register(healthPlugin);

// 8. Start
await app.start();
```

---

**Generated Capabilities**:
- ✅ Full CRUD API at `/todos`
- ✅ JWT authentication with rate limiting
- ✅ Input validation via Zod schemas
- ✅ OpenAPI spec auto-generated
- ✅ Structured logging with correlation IDs
- ✅ OpenTelemetry tracing
- ✅ Health endpoints at `/health` and `/ready`
- ✅ Introspection at `/__introspect/*` (including container state)
- ✅ Audit events sent to Kluster
- ✅ TypeScript types auto-generated
- ✅ Compile-time dependency safety
- ✅ Cyclic dependency detection

---

**Version**: 2.0
**Last Updated**: 2026-03-26
