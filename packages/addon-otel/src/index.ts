/**
 * @klusterio/kinetic-addon-otel - OpenTelemetry Addon for Kinetic
 *
 * Provides distributed tracing, metrics collection, and observability
 * for Fastify applications using OpenTelemetry standards.
 */

export { OtelAddon, createOtel } from './addon.js';
export { OtelService, type OtelConfig } from './otel-service.js';
export { createSpanMiddleware } from './middleware.js';
export type { SpanContext, TraceMiddlewareOptions } from './types.js';
