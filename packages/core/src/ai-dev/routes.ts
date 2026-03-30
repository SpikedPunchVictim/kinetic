/**
 * AI Introspection Routes
 * Provides endpoints for debugging routes, schema
 * ADR-002: Removed container dependency
 */

import type { RouteDefinition } from '../types.js';
import type { Model } from '../schema/model.js';

// ============================================================================
// Types
// ============================================================================

export interface IntrospectionRouteOptions {
  routes?: RouteDefinition[];
  models?: Model[];
  getRequestContext?: () => { requestId?: string; timestamp: string };
}

export interface RoutesIntrospectionResponse {
  routes: Array<{
    method: string;
    path: string;
    hasSchema: boolean;
    middlewareCount: number;
  }>;
}

export interface SchemaIntrospectionResponse {
  models: Array<{
    name: string;
    fields: Array<{
      name: string;
      type: string;
      required: boolean;
    }>;
    relations: string[];
  }>;
}

export interface ErrorsIntrospectionResponse {
  errors: Array<{
    timestamp: string;
    code: string;
    message: string;
    suggestion?: string;
  }>;
}

export interface ConventionsIntrospectionResponse {
  conventions: {
    naming: {
      urls: string;
      jsonFields: string;
      queryParams: string;
    };
    pagination: {
      strategy: string;
      defaultLimit: number;
      maxLimit: number;
    };
    responses: {
      envelope: boolean;
      nullHandling: string;
    };
  };
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Returns routes introspection data
 */
export function getRoutesIntrospection(
  routes: RouteDefinition[]
): RoutesIntrospectionResponse {
  return {
    routes: routes.map(r => ({
      method: r.method,
      path: r.path,
      hasSchema: !!r.schema,
      middlewareCount: r.preHandler?.length ?? 0,
    })),
  };
}

/**
 * Returns schema introspection data for models
 */
export function getSchemaIntrospection(
  models: Model[] = []
): SchemaIntrospectionResponse {
  return {
    models: models.map(model => ({
      name: model.name,
      fields: model.getFields().map(f => ({
        name: f.name,
        type: f.type,
        required: f.required,
      })),
      relations: model.getRelations().map(r => r.name),
    })),
  };
}

/**
 * Returns conventions introspection data
 */
export function getConventionsIntrospection(): ConventionsIntrospectionResponse {
  return {
    conventions: {
      naming: {
        urls: 'kebab-case',
        jsonFields: 'camelCase',
        queryParams: 'camelCase',
      },
      pagination: {
        strategy: 'cursor',
        defaultLimit: 20,
        maxLimit: 100,
      },
      responses: {
        envelope: true,
        nullHandling: 'omit',
      },
    },
  };
}

// ============================================================================
// Fastify Route Registration
// ============================================================================

interface FastifyInstance {
  get: (path: string, handler: (request: unknown, reply: unknown) => Promise<unknown> | unknown) => void;
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

/**
 * Registers introspection routes on the Fastify instance
 * Only for development mode
 *
 * @param fastify - Fastify instance
 * @param options - Introspection options including routes and models
 */
export function registerIntrospectionRoutes(
  fastify: FastifyInstance,
  options: IntrospectionRouteOptions
): void {
  const { routes = [], models = [] } = options;

  // GET /__introspect/routes - All registered routes
  fastify.get('/__introspect/routes', async () => {
    return {
      data: getRoutesIntrospection(routes),
    };
  });

  // GET /__introspect/schema - All defined models
  fastify.get('/__introspect/schema', async () => {
    return {
      data: getSchemaIntrospection(models),
    };
  });

  // GET /__introspect/conventions - Framework conventions
  fastify.get('/__introspect/conventions', async () => {
    return {
      data: getConventionsIntrospection(),
    };
  });

  // GET /__introspect/errors - Recent errors
  fastify.get('/__introspect/errors', async () => {
    return {
      data: getErrorsIntrospection(),
    };
  });

  // GET /__introspect/health - Health check
  fastify.get('/__introspect/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  if (fastify.log) {
    fastify.log.info(`Introspection routes registered at /__introspect/* (${routes.length} routes, ${models.length} models)`);
  }
}

// ============================================================================
// Security-Gated Introspection
// ============================================================================

export interface IntrospectionConfig {
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

/**
 * Registers introspection routes with environment-based security gating
 *
 * @example
 * ```typescript
 * // Dev mode (enabled by default)
 * registerSecureIntrospection(fastify, { routes, models });
 *
 * // Production (disabled by default)
 * registerSecureIntrospection(fastify, { routes, models, enabled: false });
 *
 * // Production with override (not recommended)
 * registerSecureIntrospection(fastify, {
 *   routes,
 *   models,
 *   enabled: true,
 *   allowInProduction: true
 * });
 * ```
 */
export function registerSecureIntrospection(
  fastify: FastifyInstance,
  options: IntrospectionRouteOptions & IntrospectionConfig
): void {
  const isDev = process.env.NODE_ENV === 'development';
  const isEnabled = options.enabled ?? isDev;
  const allowInProd = options.allowInProduction ?? false;

  // Security check: Don't register if disabled
  if (!isEnabled) {
    if (fastify.log) {
      fastify.log.info('Introspection disabled (set enabled: true to enable)');
    }
    return;
  }

  // Security check: Production gating
  if (process.env.NODE_ENV === 'production' && !allowInProd) {
    if (fastify.log) {
      fastify.log.warn(
        'SECURITY: Introspection blocked in production. ' +
        'Set allowInProduction: true to enable (not recommended).'
      );
    }
    return;
  }

  // Security warning if explicitly enabled in production
  if (process.env.NODE_ENV === 'production' && allowInProd) {
    if (fastify.log) {
      fastify.log.error(
        'SECURITY WARNING: Introspection enabled in production! ' +
        'This exposes internal service details and routes.'
      );
    }
  }

  // Register the routes
  registerIntrospectionRoutes(fastify, options);
}

// ============================================================================
// Error Tracking
// ============================================================================

const recentErrors: Array<{
  timestamp: string;
  code: string;
  message: string;
  suggestion?: string;
}> = [];

const MAX_ERRORS = 100;

/**
 * Tracks an error for introspection
 */
export function trackError(error: {
  code: string;
  message: string;
  suggestion?: string;
}): void {
  recentErrors.push({
    timestamp: new Date().toISOString(),
    ...error,
  });

  // Keep only recent errors
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.shift();
  }
}

/**
 * Returns recent errors for debugging
 */
export function getErrorsIntrospection(): ErrorsIntrospectionResponse {
  return {
    errors: recentErrors.slice(-20), // Last 20 errors
  };
}

/**
 * Clears the error tracking history
 */
export function clearErrorHistory(): void {
  recentErrors.length = 0;
}
