/**
 * Core type definitions for ADR-002 Framework Course Correction
 * Replaces container-based DI with explicit factory pattern
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';

// ============================================================================
// Context Types
// ============================================================================

/**
 * Application-level context
 * Created once at startup via createAppContext
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppContext extends Record<string, unknown> {}

/**
 * Request-level context
 * Created per-request via createRequestContext
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RequestContext extends Record<string, unknown> {}

// ============================================================================
// Tracing Types
// ============================================================================

/**
 * Tracer provider interface (built-in, pluggable)
 */
export interface TracerProvider {
  startSpan(name: string, options?: { parentId?: string }): Span;
}

export interface Span {
  id: string;
  setAttribute(key: string, value: unknown): void;
  end(): void;
}

// ============================================================================
// App Configuration Types
// ============================================================================

/**
 * Fastify server options (re-exported type)
 */
export interface FastifyServerOptions {
  logger?: boolean | { level: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Core framework options
 */
export interface CreateAppOptions<
  TAppContext extends AppContext,
  TRequestContext extends RequestContext = Record<string, unknown>
> {
  /**
   * Factory function to create application-level context
   * Called once at startup
   */
  createAppContext: () => Promise<TAppContext>;

  /**
   * Optional factory for request-level context
   * Called per-request in onRequest hook
   */
  createRequestContext?: (
    request: FastifyRequest,
    appContext: TAppContext
  ) => Promise<TRequestContext>;

  /**
   * Fastify server options
   */
  fastifyOptions?: FastifyServerOptions;

  /**
   * Tracer provider (in-memory for dev, OTLP for prod)
   */
  tracer?: TracerProvider;

  /**
   * Register SIGTERM/SIGINT handlers to drain and close the server.
   * @default true
   */
  gracefulShutdown?: boolean;

  /**
   * Log each request/response via Fastify's Pino instance.
   * Only active when fastifyOptions.logger is enabled.
   * @default true
   */
  requestLogging?: boolean;
}

// ============================================================================
// Fastify Extended Types
// These are used for type casting, not module augmentation
// ============================================================================

/**
 * Fastify instance extended with app context
 * Use with type assertion: `fastify as FastifyWithContext<T>`
 */
export type FastifyWithContext<TAppContext extends AppContext> = FastifyInstance & {
  /**
   * Application-level context (shared)
   */
  context: TAppContext;
};

/**
 * Fastify request extended with contexts
 * Use with type assertion: `request as FastifyRequestWithContexts<...>`
 */
export type FastifyRequestWithContexts<
  TAppContext extends AppContext,
  TRequestContext extends RequestContext
> = FastifyRequest & {
  /**
   * Request-level context (per-request, fresh)
   * Named 'requestContext' to avoid conflict with Fastify's built-in 'context'
   */
  requestContext: TRequestContext;

  /**
   * Application-level context (reference to app.context)
   */
  appContext: TAppContext;
};

// ============================================================================
// CRUD Types
// ============================================================================

/**
 * ICrud interface for database/storage implementations
 */
export interface ICrud<T, CreateInput = Omit<T, 'id'>, UpdateInput = Partial<T>> {
  create(data: CreateInput): Promise<T>;
  findById(id: string): Promise<T | null>;
  findAll(options?: { cursor?: string; limit?: number }): Promise<T[]>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

// ============================================================================
// Error Types (Condensed Format)
// ============================================================================

/**
 * Token-efficient error format
 * ~14 tokens vs ~45 in old format
 */
export interface FrameworkError {
  /**
   * Error code (abbreviated)
   * @example 'E_INIT', 'E_NF', 'E_VAL'
   */
  c: string;

  /**
   * Service/subject (minimal)
   * @example 'db', 'userService'
   */
  s: string;

  /**
   * Reason (abbreviated)
   * @example 'conn_refus', 'not_found', 'val_fail'
   */
  r: string;

  /**
   * Timestamp (unix ms)
   */
  t: number;
}

// ============================================================================
// Addon Types
// ============================================================================

/**
 * Addon factory function signature
 * Addons export these, framework does NOT manage them
 */
export type AddonFactory<TConfig, TService> = (
  config: TConfig,
  deps?: Record<string, unknown>
) => Promise<TService>;

// ============================================================================
// CRUD Route Types
// ============================================================================

export interface CrudRouteOptions<T, CreateInput, UpdateInput> {
  store: ICrud<T, CreateInput, UpdateInput>;
  middlewares?: {
    create?: unknown[];
    list?: unknown[];
    get?: unknown[];
    update?: unknown[];
    delete?: unknown[];
  };
}

// ============================================================================
// Model Types (Zod-based)
// ============================================================================

export interface ModelDefinition<T extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  fields: T;
}

export interface Model<T extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  getSchema(): z.ZodObject<T>;
  getFields(): FieldInfo[];
  getRelations(): RelationInfo[];
  inputSchema: z.ZodObject<T>;
  outputSchema: z.ZodObject<T>;
}

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  zodType: string;
}

export interface RelationInfo {
  name: string;
  type: 'hasOne' | 'hasMany' | 'belongsTo';
  to: string;
  foreignKey?: string;
}

// ============================================================================
// Introspection Types
// ============================================================================

/**
 * Introspection options (security-gated)
 */
export interface IntrospectionOptions {
  /**
   * Enable introspection routes
   * @default process.env.NODE_ENV === 'development'
   */
  enabled?: boolean;

  /**
   * Allow in production (with warning)
   * @default false
   */
  allowInProduction?: boolean;
}

// ============================================================================
// OpenAPI Types
// ============================================================================

export interface OpenApiOptions {
  /**
   * API title
   */
  title: string;

  /**
   * API version
   */
  version: string;

  /**
   * Output file path (optional, defaults to stdout)
   */
  outputPath?: string;
}

// ============================================================================
// Route Definition Types
// ============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Request {
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  headers: Record<string, string>;
  ip?: string;
}

export interface Reply {
  code: (code: number) => Reply;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (payload?: any) => void;
}

export interface RouteHandler {
  (request: Request, reply: Reply): Promise<unknown> | unknown;
}

export interface Middleware {
  (request: Request, reply: Reply): Promise<void> | void;
}

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
  preHandler?: Middleware[];
  schema?: {
    body?: z.ZodType;
    querystring?: z.ZodType;
    params?: z.ZodType;
    response?: z.ZodType;
  };
}
