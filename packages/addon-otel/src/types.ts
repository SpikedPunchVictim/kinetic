/**
 * OpenTelemetry types for Kinetic
 */

/**
 * Span context attached to each request
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  isRecording: boolean;
}

/**
 * Options for trace middleware
 */
export interface TraceMiddlewareOptions {
  /**
   * Include request body in span attributes (default: false for privacy)
   */
  captureBody?: boolean;

  /**
   * Include request headers in span attributes (default: false)
   */
  captureHeaders?: boolean;

  /**
   * Headers to capture (if captureHeaders is true)
   * Supports wildcards: 'x-*', 'authorization'
   */
  headerAllowList?: string[];

  /**
   * Skip tracing for paths matching these patterns
   * e.g., ['/health', '/__introspect/*']
   */
  skipPaths?: string[];

  /**
   * Custom span name provider
   */
  spanName?: (req: { method: string; url: string; hostname: string; protocol: string; id?: string }) => string;
}

/**
 * Metric recording options
 */
export interface MetricOptions {
  /**
   * Metric name (alphanumeric with underscores)
   */
  name: string;

  /**
   * Metric value
   */
  value: number;

  /**
   * Metric labels/dimensions
   */
  labels?: Record<string, string>;

  /**
   * Metric unit (e.g., 'ms', 'bytes', 'count')
   */
  unit?: string;
}

/**
 * Health check result for OTel integration
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, { status: 'up' | 'down'; details?: Record<string, unknown> }>;
  timestamp: string;
}

/**
 * Request-scoped telemetry data
 * Attached to req.requestContext.telemetry
 */
export interface RequestTelemetry {
  span: {
    id: string;
    name: string;
    startTime: number;
    setAttribute: (key: string, value: unknown) => void;
    end: () => void;
  };
  traceId: string;
}
