# ADR-002: Framework Course Correction

## Status
**Proposed** — Awaiting approval before implementation

## Context

Post-review analysis ("The Fool's Report") revealed critical gaps between architecture claims and implementation reality. This ADR documents the necessary course corrections to align the framework with its stated goals of being "AI-optimized," "compile-time safe," and "token-efficient."

### Problems Identified

| # | Finding | Severity | ADR Violated |
|---|---------|----------|--------------|
| 1 | "Compile-time safety" is fake (runtime regex parsing) | Critical | AH-02 |
| 2 | CRUD "auto-generation" throws errors | Critical | CM-02 |
| 3 | OpenTelemetry is a mock | Critical | OB-01 |
| 4 | Error messages waste tokens | High | TE-01 |
| 5 | Addon system doesn't call install() | High | AC-04 |
| 6 | Pagination enforcement never called | Medium | CM-02 |
| 7 | Introspection lacks NODE_ENV check | High | SC-01 |
| 8 | Duplicate code (pluralize, generateUrlPath) | Low | - |
| 9 | Naming convention enforcement causes hallucinations | High | AH-05 |
| 10 | OpenAPI generation not implemented | Critical | CM-03 |

## Decision

We will implement the following corrections in prioritized phases:

1. **Phase 1: True Type Safety** — Replace runtime regex with compile-time types
2. **Phase 2: Token Efficiency** — Condense errors, remove dead code
3. **Phase 3: Functional CRUD** — ICrud interface pattern
4. **Phase 4: Modular Observability** — Extract OTel, add dev-mode tracer
5. **Phase 5: Working Addons** — Implement lifecycle hooks
6. **Phase 6: Security Fixes** — Environment-gated introspection, honest docs

---

## Phase 1: Eliminate Container - Explicit Context Factory

### Problem
Current container uses `fn.toString()` + regex for dependency extraction - FAKE compile-time safety:

```typescript
// container.ts: LIES about being "compile-time safe"
function extractDependencies(factory: ServiceFactory<unknown>): string[] {
  const fn = factory as unknown as Function;
  const str = fn.toString();  // RUNTIME string extraction!
  const destructuredMatch = str.match(/^\s*(?:async\s*)?\(?:?\{([^}]+)\}\s*\)?/);
  // ...regex parsing
}
```

This breaks with:
- Minification (variable names change)
- Bundlers (source transform)
- Arrow functions with implicit returns
- Any compile-to-JS language

### Solution: Two-Level Context Factory Pattern

```typescript
// App-level context: Created once at startup
interface AppContext {
  db: DbService;
  cache: CacheService;
  jwt: JwtService;
}

// Request-level context: Created per request
interface RequestContext {
  user: User;      // From auth middleware
  span: Span;      // From tracing
  // Can access appContext via fastify.appContext
}

// ADDONS export factory functions, not classes
export const DbAddon = {
  async create(url: string): Promise<DbService> {
    const db = await createConnection(url);
    return {
      query: db.query.bind(db),
      close: () => db.close(),
    };
  }
};

export const JwtAddon = {
  async create(config: { secret: string; db: DbService }): Promise<JwtService> {
    return new JwtServiceImpl(config);
  }
};

// USAGE: User controls initialization order and dependencies
const app = await createApp<AppContext, RequestContext>({
  createAppContext: async () => {
    // Order is explicit - no magic
    const db = await DbAddon.create(env.DATABASE_URL);
    const cache = await CacheAddon.create({ db });
    const jwt = await JwtAddon.create({
      secret: env.JWT_SECRET,
      db, // Explicit dependency injection
    });

    // TypeScript verifies this matches AppContext
    return { db, cache, jwt };
  },

  createRequestContext: async (req, appContext) => {
    // Per-request context
    const user = await verifyToken(req.headers.authorization, appContext.jwt);
    const span = appContext.tracer?.startSpan(req.url);

    return { user, span };
  },

  fastifyOptions: { logger: true },
});

// Usage in handlers: fully typed
fastify.get('/users', async (req, reply) => {
  // req.appContext - AppContext type
  // req.context - RequestContext type
  const user = await req.appContext.db.query('SELECT * FROM users WHERE id = $1', [id]);
  const token = await req.appContext.jwt.sign({ userId: user.id });

  // Request-scoped
  const currentUser = req.context.user;
  req.context.span?.setAttribute('user.id', currentUser.id);
});
```

### Type Safety Benefits

| Before (Runtime Regex) | After (Explicit Context Factory) |
|------------------------|----------------------------------|
| Error on `initialize()` | Error at write-time |
| "databse" typo passes TypeScript | "databse" typo caught by IDE |
| Minification breaks deps | Works with any bundler |
| No IntelliSense for deps | Full autocomplete on both contexts |
| Runtime validation overhead | Zero overhead |}

### Migration Path

Old code (runtime DI container):
```typescript
const container = createContainer();
container.register('db', async () => new Database());
container.register('userService', async ({ db }) => new UserService(db));
//                                       ^ dep inference via fn.toString() - BROKEN
await container.initialize();
const service = await container.get('userService');
```

New code (explicit context factory):
```typescript
const app = await createApp<{ db: Database; userService: UserService }>({
  createAppContext: async () => {
    // Order is explicit - no magic
    const db = await DbAddon.create(env.DATABASE_URL);
    const userService = await UserServiceAddon.create({ db });
    return { db, userService }; // TypeScript validates
  },
});

// Access via decorator
const service = app.context.userService; // ✓ Fully typed
```

**Breaking change:**
- Removes "magic" dependency inference (no fn.toString())
- Removes container registration/get pattern
- User explicitly constructs context with factory functions
- TypeScript validates at compile-time

---

## Phase 2: Token-Efficient Error Messages

### Problem
Current error messages are verbose:

```typescript
// BEFORE: ~40 tokens
throw new FrameworkError({
  code: ErrorCodes.INIT_FAILURE,
  message: `Failed to initialize service '${name}': ${err.message}`,
  suggestion: `Check the factory for '${name}'. Common causes:\n1. Missing deps\n2. Async errors\n3. Config issues`,
  docsUrl: '',  // Empty string wastes tokens!
});

/* JSON output:
{
  "code": "INIT_FAILURE",
  "message": "Failed to initialize service 'db': connection refused",
  "suggestion": "Check the factory for 'db'. Common causes:\n1. Missing deps\n2. Async errors\n3. Config issues",
  "docsUrl": ""
}
// ~180 chars = ~45 tokens for empty docsUrl + newlines + verbose text
*/
```

### Solution: Condensed Error Format

```typescript
// NEW: ~8 tokens
throw new FrameworkError({
  c: 'E_INIT',     // code: compact
  s: 'db',         // service: minimal
  r: 'conn_refus',  // reason: abbreviated
  t: Date.now(),   // timestamp for debugging
});

/* JSON output:
{"c":"E_INIT","s":"db","r":"conn_refus","t":1711234567890}
// ~55 chars = ~14 tokens
// 3.2x reduction in token usage
*/

// Human-readable mapping lives in documentation, NOT in error
const ERROR_MAP: Record<string, string> = {
  'E_INIT': 'Initialization failed',
  'conn_refus': 'Connection refused - check database URL',
};
```

### Error Code Schema

| Field | Old | New | Meaning |
|-------|-----|-----|---------|
| code | `'INIT_FAILURE'` | `'E_INIT'` | 6 chars vs 12 |
| service | `'Failed to initialize service \'userService\''` | `'userService'` | Raw name only |
| reason | embedded in message | `'conn_refus'` | Abbreviated error |
| suggestion | 3 bullet points | external | Docs, not JSON |
| docsUrl | `''` (empty) | removed | No empty strings |
| timestamp | - | `t: 1711...` | Unix ms for trace |

---

## Phase 3: ICrud Interface for CRUD

### Problem
"Auto-generated" CRUD routes throw errors:

```typescript
// routes.ts: Claims "auto-generates" but...
if (opts.create?.enabled) {
  routes.push({
    method: 'POST',
    path: basePath,
    handler: opts.create.handler ?? createDefaultHandler(model, 'create'),
    //                                               ^^^^^^^^^^^^^^^^^
    //                                               THROWS FrameworkError!
  });
}

function createDefaultHandler(model: Model, operation: string) {
  return async () => {
    throw new FrameworkError({
      code: ErrorCodes.NOT_IMPLEMENTED,
      message: `No handler provided for ${operation}`,  // LIE: "auto-generated"
    });
  };
}
```

### Solution: Explicit ICrud Interface

```typescript
// Define storage contract
interface ICrud<T, CreateInput = Omit<T, 'id'>, UpdateInput = Partial<T>> {
  create(data: CreateInput): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(options?: { cursor?: string; limit?: number }): Promise<T[]>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

// Built-in in-memory implementation for POC
class MemoryStore<T extends { id: string }> implements ICrud<T> {
  private data = new Map<string, T>();

  async create(data: Omit<T, 'id'>): Promise<T> {
    const entity = { ...data, id: crypto.randomUUID() } as T;
    this.data.set(entity.id, entity);
    return entity;
  }

  async findById(id: string): Promise<T | null> {
    return this.data.get(id) ?? null;
  }

  async findAll(opts?: { limit?: number }): Promise<T[]> {
    const items = [...this.data.values()];
    return opts?.limit ? items.slice(0, opts.limit) : items;
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const existing = this.data.get(id);
    if (!existing) throw new Error('Not found');
    const updated = { ...existing, ...data };
    this.data.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }
}

// Usage: generateCrudRoutes now requires store
const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  },
});

const routes = generateCrudRoutes(UserModel, {
  store: new MemoryStore(),  // Required!
  middleware: {
    create: [authMiddleware],  // Optional
  },
});

// Production: swap to real database
const dbStore: ICrud<User> = {
  create: async (data) => {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },
  // ...implement with Drizzle/Prisma/raw SQL
};

const prodRoutes = generateCrudRoutes(UserModel, { store: dbStore });
```

### Benefits

| Before | After |
|--------|-------|
| Throws "No handler provided" | Actually implements CRUD |
| Magical store lookup | Explicit store injection |
| Confusion about "auto-generation" | Clear: ICrud required |
| Only works if AI writes handler | Works with any ICrud impl |

---

## Phase 4: Modular Observability

### Problem
`@opentelemetry/api` is a dependency but implementation is 50-line mock:

```typescript
// observability/index.ts: MOCK, not real OTel
export const tracer = {
  startSpan: (name: string) => ({
    id: crypto.randomUUID(),  // Not a real trace ID!
    startTime: Date.now(),
    end: () => {},
    setAttribute: () => {},
  }),
};
```

### Solution: Extract to Package + In-Memory Dev Tracer

**1. Move OTel to @klusterio/kinetic-otel**

```typescript
// packages/kinetic-otel/src/index.ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function createOtelTracer(options: {
  serviceName: string;
  otlpEndpoint: string;
}) {
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: options.serviceName,
    }),
  });

  const exporter = new OTLPTraceExporter({
    url: options.otlpEndpoint,
  });

  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  return provider.getTracer('kinetic');
}
```

**2. Core Framework: In-Memory Tracer for Dev**

```typescript
// core/src/observability/tracer.ts
interface LogEntry {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  parentId?: string;
  attributes: Record<string, unknown>;
}

export class InMemoryTracer {
  private logs: LogEntry[] = [];
  private maxLines = 2500;

  startSpan(name: string, options?: { parentId?: string }): Span {
    const id = crypto.randomUUID();
    const entry: LogEntry = {
      id,
      name,
      startTime: Date.now(),
      parentId: options?.parentId,
      attributes: {},
    };

    this.logs.push(entry);
    this.rotateIfNeeded();

    return {
      id,
      setAttribute: (key: string, value: unknown) => {
        entry.attributes[key] = value;
      },
      end: () => {
        entry.endTime = Date.now();
      },
    };
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  private rotateIfNeeded(): void {
    if (this.logs.length > this.maxLines) {
      this.logs = this.logs.slice(-this.maxLines);
    }
  }
}

// REST endpoint for AI introspection
fastify.get('/__debug/traces', async () => {
  return tracer.getLogs().map(l => ({
    n: l.name,
    s: l.startTime,
    e: l.endTime,
    d: l.endTime ? l.endTime - l.startTime : null,
  }));
});
```

**3. Pluggable Tracer Interface**

```typescript
// core/src/observability/types.ts
export interface Tracer {
  startSpan(name: string, options?: { parentId?: string }): Span;
}

export interface Span {
  id: string;
  setAttribute(key: string, value: unknown): void;
  end(): void;
}

// App accepts custom tracer
const app = createApp({
  tracer: process.env.NODE_ENV === 'production'
    ? new OtelTracer({ otlpEndpoint: process.env.OTLP_URL })  // Real OTel
    : new InMemoryTracer(),  // Dev tracer
});
```

---

## Phase 5: Addon Pattern Shift

### Problem
Addons log but `install()` is never called - AND container-based DI adds complexity:

```typescript
// app.ts: Placebo
if (options.addons) {
  for (const addon of options.addons) {
    // ADDONS REGISTERED BUT NOT YET IMPLEMENTED
    this.fastify.log.info(`Registered addon: ${addon.name}`);
    // ^ Never calls addon.install()
  }
}
```

### Solution: Factory Functions + Fastify Hooks

Add-ons export factory functions that self-configure using Fastify's native hooks:

```typescript
// DbAddon.ts - exports factory, not an object
export interface DbAddonConfig {
  url: string;
  poolSize?: number;
}

export interface DbService {
  query: (sql: string, params: unknown[]) => Promise<unknown[]>;
  transaction: <T>(fn: (db: DbService) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

export const DbAddon = {
  async create(config: DbAddonConfig): Promise<DbService> {
    const db = await createPool(config);
    const service: DbService = {
      query: db.query.bind(db),
      transaction: db.transaction.bind(db),
      close: async () => db.end(),
    };
    return service;
  },

  // Optional: Hook registration if addon needs Fastify lifecycle
  registerHooks(fastify: FastifyInstance, service: DbService): void {
    fastify.addHook('onReady', async () => {
      await service.query('SELECT 1'); // Health check
      fastify.log.info('Database connected');
    });

    fastify.addHook('onClose', async () => {
      await service.close();
      fastify.log.info('Database disconnected');
    });
  },
};

// JwtAddon.ts - depends on other add-ons
export interface JwtAddonConfig {
  secret: string;
  expiresIn?: string;
}

export interface JwtService {
  sign: (payload: Record<string, unknown>) => Promise<string>;
  verify: (token: string) => Promise<Record<string, unknown>>;
  middleware: FastifyPlugin;
}

export const JwtAddon = {
  async create(
    config: JwtAddonConfig,
    deps?: { db?: DbService } // Optional dependencies
  ): Promise<JwtService> {
    const service = new JwtServiceImpl(config.secret, config.expiresIn);

    return {
      sign: service.sign.bind(service),
      verify: service.verify.bind(service),
      middleware: async (fastify) => {
        // Self-register authentication hook
        fastify.addHook('onRequest', async (req) => {
          const token = req.headers.authorization?.replace('Bearer ', '');
          if (!token) return;
          req.user = await service.verify(token);
        });
      },
    };
  },
};

// Usage in createApp - user controls composition
import { DbAddon } from '@klusterio/kinetic-db-addon';
import { JwtAddon } from '@klusterio/kinetic-jwt-addon';

interface MyAppContext {
  db: DbService;
  jwt: JwtService;
}

const app = await createApp<MyAppContext>({
  createAppContext: async () => {
    // Order is explicit - no framework magic
    const db = await DbAddon.create({ url: env.DATABASE_URL });
    const jwt = await JwtAddon.create(
      { secret: env.JWT_SECRET },
      { db } // Explicit dependency
    );

    // Set up Fastify hooks
    DbAddon.registerHooks(app, db);
    await jwt.middleware(app);

    return { db, jwt };
  },
});
```

### Benefits

| Aspect | Old (Container + install()) | New (Factory + Explicit) |
|--------|-----------------------------|--------------------------|
| **Type Safety** | ⚠️ Runtime validation | ✅ Compile-time types |
| **Dependency Order** | Framework-controlled | ✅ User-controlled, explicit |
| **Hook System** | Custom lifecycle hooks | ✅ Fastify native hooks |
| **Testability** | Mock container | ✅ Inject mocks directly |
| **Bundle Size** | Container + addon overhead | ✅ Just addon code |
| **Visibility** | Hidden inside container | ✅ Transparent in code |

### No Add-On Interaction Required

As confirmed: "Addons should not need to interact with each other."

Each addon:
1. Exports factory function(s)
2. Uses Fastify hooks for lifecycle if needed
3. Returns typed services
4. User assembles in `createAppContext`

---

## Phase 6: Security & Honesty

### 6.1 Environment-Gated Introspection

```typescript
// ai-dev/routes.ts: NOW WITH SAFETY CHECK
export function registerIntrospectionRoutes(
  fastify: FastifyInstance,
  options: { enabled?: boolean }
): void {
  // SAFETY: Require explicit dev mode or enabled flag
  if (process.env.NODE_ENV !== 'development' && options.enabled !== true) {
    fastify.log.warn(
      'Introspection routes skipped: not in development and not explicitly enabled'
    );
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    fastify.log.error(
      'SECURITY WARNING: Introspection enabled in production. ' +
      'This exposes internal service dependencies.'
    );
    // Still allow if explicitly enabled, but warn loudly
  }

  // Register routes only if passed safety check
  fastify.get('/__introspect/routes', async () => { ... });
  fastify.get('/__introspect/services', async () => { ... });
  fastify.get('/__introspect/errors', async () => { ... });
}
```

### 6.2 Remove Naming Convention Enforcement

```typescript
// DELETE: model.ts lines 54-68
// DELETE: camelCase pattern validation
// DELETE: snakeToCamel suggestion

// REASON: Validation causes hallucinations
// - Blocks valid DB field names (user_id)
// - Suggestions can point to existing fields
// - Assumes conventions without context

// NEW: Accept any valid identifier
function validateFieldName(fieldName: string): void {
  // Only check for JavaScript identifier validity
  if (!/^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(fieldName)) {
    throw new FrameworkError({
      c: 'E_INVALID_FIELD',
      s: fieldName,
      r: 'not_js_identifier',
      t: Date.now(),
    });
  }
}
```

### 6.3 Consolidate Duplicate Utilities

```typescript
// Move ALL utilities to conventions.ts
// Remove from model.ts:
// - pluralize() → import from conventions.ts
// - generateUrlPath() → import from conventions.ts

// schema/index.ts exports:
export { pluralize, generateUrlPath, getCollectionPath } from './conventions.js';

// model.ts uses:
import { pluralize, generateUrlPath } from './conventions.js';
```

---

## Dependencies

### Remove
- `@opentelemetry/api` → moved to `@klusterio/kinetic-otel`

### Keep
- `zod` - Core to schema system
- `fastify` - Core framework

### Add
- `zod-to-json-schema` (optional) - For OpenAPI generation

---

## Migration Guide

### For Framework Users

**Breaking Changes:**

1. **Container replaced with explicit context factory:**
   ```typescript
   // BEFORE: Container-based DI
   const container = createContainer();
   container.register('db', async () => new Database());
   container.register('userService', async ({ db }) => new UserService(db));
   await container.initialize();
   const service = await container.get('userService');

   // AFTER: Explicit context factory
   const app = await createApp<{ db: Database; userService: UserService }>({
     createAppContext: async () => {
       const db = await DbAddon.create(config.db);
       const userService = await UserServiceAddon.create({ db });
       return { db, userService }; // TypeScript validates
     },
   });

   // Access via app.context
   const userService = app.context.userService; // ✓ Fully typed
   ```

2. **CRUD routes require ICrud store:**
   ```typescript
   // BEFORE
   generateCrudRoutes(model, { read: { enabled: true } });  // Throws error

   // AFTER
   generateCrudRoutes(model, { store: new MemoryStore() });  // Works!
   // Or production:
   generateCrudRoutes(model, { store: drizzleUserStore });  // Implements ICrud
   ```

3. **Error format changed:**
   ```typescript
   // BEFORE
   { code: 'INIT_FAILURE', message: '...', suggestion: '...', docsUrl: '' }

   // AFTER
   { c: 'E_INIT', s: 'db', r: 'conn_refus', t: 1711234567890 }
   ```

4. **Request context for per-request services:**
   ```typescript
   // AFTER: Two-level context
   const app = await createApp<AppContext, RequestContext>({
     createAppContext: async () => ({ db, jwt }),
     createRequestContext: async (req, appCtx) => ({
       user: await appCtx.jwt.verify(req.headers.authorization),
       span: appCtx.tracer?.startSpan(req.url),
     }),
   });

   // Usage in handler
   fastify.get('/users', async (req) => {
     const user = req.context.user; // RequestContext
     await req.appContext.db.query(...); // AppContext
   });
   ```

### For Addons

**Update addon pattern:**
```typescript
// BEFORE: defineAddon with install()
export default defineAddon({
  name: 'my-addon',
  services: { ... },
  async install(app) {
    // Never called!
  },
});

// AFTER: Factory function exports
export interface MyAddonConfig {
  apiKey: string;
}

export interface MyService {
  callApi(): Promise<unknown>;
}

export const MyAddon = {
  async create(config: MyAddonConfig): Promise<MyService> {
    return {
      callApi: async () => { ... },
    };
  },

  registerHooks(fastify: FastifyInstance, service: MyService): void {
    // Optional: use Fastify hooks
    fastify.addHook('onReady', () => console.log('MyAddon ready'));
  },
};

// Usage
const myService = await MyAddon.create({ apiKey: env.API_KEY });
MyAddon.registerHooks(app, myService);
```

---

## Success Criteria

| Criterion | Before | After |
|-----------|--------|-------|
| "Compile-time" safety | Runtime regex | True TypeScript validation |
| Error tokens | ~45 tokens | ~14 tokens (3x reduction) |
| CRUD "auto-generation" | Throws error | Implements ICrud interface |
| OpenTelemetry | 50-line mock | Real OTel in separate package |
| Addon install | Never called | Full lifecycle hooks |
| Introspection | Always enabled | Dev-only by default |
| Naming enforcement | Throws on user_id | Accepts valid JS identifiers |
| Code duplication | pluralize × 2 | Single source of truth |

---

## Consequences

### Positive
- **Honesty**: Implementation matches documentation
- **Type Safety**: True compile-time checking via TypeScript
- **Token Efficiency**: 3x reduction in error message tokens
- **Modularity**: OTel extracted, core is leaner
- **Flexibility**: ICrud works with any database
- **Security**: Introspection gated by environment

### Negative
- **Breaking Changes**: All framework users must update
- **Explicitness Burden**: AI must declare dependencies explicitly
- **More Code for Users**: Must implement ICrud for production
- **Migration Effort**: Existing projects need updates

### Neutral
- **Architecture Alignment**: Closer to ADR-001 intent
- **Honest Documentation**: Features described actually exist

---

## Implementation Order

### Phase 1: Foundation (Week 1-2)
- **Task 4**: Design explicit context factory types (AppContext/RequestContext)
- **Task 7**: Audit and remove unused dependencies (@opentelemetry/api)
- **Task 5**: Condense error messages for tokens
- **Task 6**: Consolidate duplicate utility functions (pluralize, generateUrlPath)
- **Task 10**: Remove naming convention enforcement

### Phase 2: Core Framework (Week 3-4)
- **Task 1**: Remove fn.toString() runtime parsing (delete container.ts)
- **Task 2**: Implement createApp with typed contexts
- **Task 3**: Update validation logic - remove container dependency
- **Task 13**: Implement ICrud interface for CRUD helper functions

### Phase 3: Addons & Observability (Week 5)
- **Task 12**: Convert addons to factory pattern (factory functions + Fastify hooks)
- **Task 11**: Create @klusterio/kinetic-otel package or in-app tracer interface

### Phase 4: Security & Documentation (Week 6)
- **Task 8**: Add environment-gated introspection
- **Task 9**: Implement OpenAPI 3.1 generation from Zod schemas

---

## Decisions Made

### 1. Container Deletion Strategy
✅ **Option A**: Delete container.ts entirely. Clean break. Current container is fundamentally broken.

### 2. Request Context Initialization
✅ **Option A**: Called per-request in `onRequest` hook. Fresh context per request.

### 3. Tracing Architecture
✅ **Option B**: Built-in to core with pluggable exporter. Tracer is part of framework, not addon. Provides:
- In-memory tracer (development)
- OTLP exporter integration (production)
- Configurable via `createApp({ tracer: ... })`

---

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/container.ts` | DELETE | Remove entire file -> fake compile-time safety |
| `packages/core/src/app.ts` | REWRITE | Replace container with explicit context factory |
| `packages/core/src/index.ts` | UPDATE | Export new APIs (createApp), remove container exports |
| `packages/core/src/schema/model.ts` | UPDATE | Remove validateFieldName, remove duplicate utils |
| `packages/core/src/schema/conventions.ts` | KEEP | Move pluralize, generateUrlPath here |
| `packages/core/src/errors.ts` | UPDATE | Condense error format |
| `packages/core/src/security/middleware.ts` | VERIFY | Should work with new context |
| `packages/core/src/ai-dev/routes.ts` | ADD | Environment gate for introspection |
| `packages/core/src/schema/routes.ts` | UPDATE | Use ICrud interface |
| `packages/core/package.json` | UPDATE | Remove @opentelemetry/api |
| `packages/jwt-addon/src/index.ts` | REWRITE | Convert to factory pattern |
| `packages/otel/` | CREATE | New package (if extracting OTel) |

---

**Author**: Claude (TypeScript Pro)
**Based on**: The Fool's Report (@klusterio/kinetic-core Critical Analysis)
**Date**: 2026-03-28
**Status**: Proposed — Awaiting approval
