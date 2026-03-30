/**
 * Fastify middleware for OpenTelemetry tracing
 *
 * Creates spans for each request with relevant attributes
 * and adds telemetry context to the request object.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { OtelService } from './otel-service.js';
import type { TraceMiddlewareOptions, RequestTelemetry } from './types.js';

/**
 * Default options for trace middleware
 */
const defaultMiddlewareOptions: TraceMiddlewareOptions = {
  captureBody: false,
  captureHeaders: false,
  skipPaths: ['/health', '/healthz', '/ready', '/__introspect/*', '/__debug/*'],
};

/**
 * Get route pattern from request
 * Falls back to url if route pattern not available
 */
function getRoutePattern(req: FastifyRequest): string {
  // @ts-expect-error - routerPath is available at runtime but not in types
  return req.routerPath || (req as unknown as { routeOptions?: { url?: string } }).routeOptions?.url || req.url;
}

/**
 * Create Fastify middleware for tracing
 *
 * @param otelService - Initialized OtelService instance
 * @param options - Middleware configuration options
 * @returns Fastify preHandler function
 */
export function createSpanMiddleware(
  otelService: OtelService,
  options: TraceMiddlewareOptions = {}
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const opts = { ...defaultMiddlewareOptions, ...options };

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Skip tracing for health checks and introspection endpoints
    if (shouldSkip(req.url, opts.skipPaths ?? [])) {
      return;
    }

    const routePattern = getRoutePattern(req);
    const spanName = opts.spanName
      ? opts.spanName({
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          protocol: req.protocol,
          id: req.id,
        })
      : `${req.method} ${routePattern}`;

    // Start span with request attributes
    const spanProps: Record<string, unknown> = {
      'http.method': String(req.method),
      'http.url': String(req.url),
      'http.host': String(req.hostname),
      'http.scheme': String(req.protocol),
      'http.route': routePattern,
    };

    // Add request ID if available
    if (req.id) {
      spanProps['http.request_id'] = String(req.id);
    }

    const spanData = otelService.startSpan(spanName, spanProps);

    // Attach telemetry context to request for use in handlers
    const telemetry: RequestTelemetry = {
      span: {
        id: spanData.id,
        name: spanName,
        startTime: Date.now(),
        setAttribute: spanData.setAttribute,
        end: spanData.end,
      },
      traceId: spanData.id, // Simplified - in reality traceId comes from propagator
    };

    // Add to request
    (req as unknown as { telemetry?: RequestTelemetry }).telemetry = telemetry;

    // Hook into response
    reply.raw.once('finish', () => {
      // Add response attributes
      spanData.setAttribute('http.status_code', reply.statusCode);
      spanData.setAttribute(
        'http.response_size',
        Number(reply.raw.getHeader('content-length') ?? 0)
      );

      // Mark span status based on HTTP code
      if (reply.statusCode >= 500) {
        spanData.setAttribute('http.status_class', 'server_error');
      } else if (reply.statusCode >= 400) {
        spanData.setAttribute('http.status_class', 'client_error');
      } else {
        spanData.setAttribute('http.status_class', 'success');
      }

      // Add duration
      spanData.setAttribute('http.duration_ms', Date.now() - telemetry.span.startTime);

      spanData.end();
    });
  };
}

/**
 * Check if URL should be skipped based on patterns
 */
function shouldSkip(url: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Direct match
    if (url === pattern) return true;

    // Wildcard match
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(url)) return true;
    }
  }
  return false;
}

/**
 * Register OTel middleware and endpoints with Fastify
 *
 * @param fastify - Fastify instance
 * @param otelService - Initialized OtelService
 * @param options - Middleware options
 */
export async function registerOtelMiddleware(
  fastify: FastifyInstance,
  otelService: OtelService,
  options?: TraceMiddlewareOptions
): Promise<void> {
  // Register preHandler hook for tracing
  fastify.addHook('onRequest', createSpanMiddleware(otelService, options));

  // Add telemetry endpoint for debugging
  fastify.get('/__debug/telemetry', async () => {
    return {
      service: otelService.getConfig().serviceName,
      ready: otelService.isReady(),
      timestamp: new Date().toISOString(),
    };
  });
}
