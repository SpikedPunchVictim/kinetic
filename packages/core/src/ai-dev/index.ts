/**
 * AI Developer Experience submodule
 * Introspection and debugging utilities for AI-assisted development
 */

export {
  registerIntrospectionRoutes,
  registerSecureIntrospection,
  trackError,
  getErrorsIntrospection,
  clearErrorHistory,
  type IntrospectionRouteOptions,
  type IntrospectionConfig,
  type RoutesIntrospectionResponse,
  type SchemaIntrospectionResponse,
  type ConventionsIntrospectionResponse,
  type ErrorsIntrospectionResponse,
} from './routes.js';

export {
  createIntrospectionPlugin,
  type IntrospectionPluginOptions,
} from './plugin.js';
