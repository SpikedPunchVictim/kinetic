/**
 * @klusterio/kinetic-core - Framework core exports
 * ADR-002: Factory pattern with explicit contexts
 */

// Core app exports - main entry point
export { createApp } from './app.js';

// Schema exports
export { generateCrudRoutes, defineModel } from './schema/index.js';

// Error exports
export { FrameworkError, ErrorCodes } from './errors.js';

// Store exports
export { MemoryStore } from './crud/store.js';

// Service + middleware helpers
export { defineService } from './service.js';
export type { ServiceHooks } from './service.js';
export { defineMiddleware } from './middleware.js';
export type { NamedMiddleware } from './middleware.js';

// Env helpers
export { defineEnv, getEnvRegistry, clearEnvRegistry } from './env.js';
export type { EnvResult, EnvGroup } from './env.js';

// Tracer exports
export { InMemoryTracer, registerTraceEndpoint } from './tracer.js';

// Type exports
export type {
  CreateAppOptions,
  FastifyWithContext,
  FastifyRequestWithContexts,
  AppContext,
  RequestContext,
  ICrud,
  TracerProvider,
  Span,
  FrameworkError as FrameworkErrorType,
  Model,
  ModelDefinition,
  RouteDefinition,
} from './types.js';
