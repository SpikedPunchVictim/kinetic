/**
 * OpenTelemetry Addon for Kinetic
 *
 * ADR-002 Compatible - Factory pattern for creating OTel services
 */

import type { FastifyInstance } from 'fastify';
import { OtelService, type OtelConfig } from './otel-service.js';
import { registerOtelMiddleware, createSpanMiddleware } from './middleware.js';
import type { TraceMiddlewareOptions } from './types.js';

/**
 * Re-export types
 */
export { OtelService, type OtelConfig };
export { createSpanMiddleware, registerOtelMiddleware };

/**
 * OpenTelemetry Addon
 *
 * Factory pattern for creating and managing OTel instances.
 *
 * @example
 * ```typescript
 * import { createApp } from '@klusterio/kinetic-core';
 * import { OtelAddon } from '@klusterio/addon-otel';
 *
 * const otel = await OtelAddon.create({
 *   serviceName: 'my-service',
 *   environment: 'production',
 *   tracesEndpoint: 'http://localhost:4318/v1/traces',
 * });
 *
 * const app = await createApp<{
 *   otel: ReturnType<typeof OtelAddon.create> extends Promise<infer T> ? T : never;
 * }>({
 *   createAppContext: async () => {
 *     return { otel };
 *   },
 * });
 *
 * // Register middleware
 * await OtelAddon.registerHooks(app, otel);
 * ```
 */
export const OtelAddon = {
  /**
   * Create an OtelService instance
   * Initializes the OpenTelemetry SDK with the provided configuration
   *
   * @param config - OTel configuration
   * @returns Initialized OtelService
   */
  async create(config: OtelConfig): Promise<OtelService> {
    const service = new OtelService(config);
    await service.init();
    return service;
  },

  /**
   * Register Fastify hooks for automatic request tracing
   *
   * @param fastify - Fastify instance
   * @param otelService - Initialized OtelService
   * @param options - Middleware options
   */
  async registerHooks(
    fastify: FastifyInstance,
    otelService: OtelService,
    options?: TraceMiddlewareOptions
  ): Promise<void> {
    await registerOtelMiddleware(fastify, otelService, options);
  },

  /**
   * Create a span manually for custom operations
   * Useful for tracing background jobs or complex operations
   *
   * @param otelService - Initialized OtelService
   * @param name - Span name
   * @param operation - Function to execute within the span
   * @returns Operation result
   */
  async withSpan<T>(
    otelService: OtelService,
    name: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const span = otelService.startSpan(name);
    try {
      const result = await operation();
      span.setAttribute('success', true);
      return result;
    } catch (error) {
      span.setAttribute('error', true);
      span.setAttribute('error.message', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      span.end();
    }
  },

  /**
   * Create middleware function for use in route handlers
   * Allows manual span creation in specific routes
   *
   * @param otelService - Initialized OtelService
   * @param options - Middleware options
   * @returns Express/Fastify compatible middleware function
   */
  middleware(otelService: OtelService, options?: TraceMiddlewareOptions) {
    return createSpanMiddleware(otelService, options);
  },
};

/**
 * Convenience function for creating the addon
 * Alias for OtelAddon.create
 */
export function createOtel(config: OtelConfig): Promise<OtelService> {
  return OtelAddon.create(config);
}
