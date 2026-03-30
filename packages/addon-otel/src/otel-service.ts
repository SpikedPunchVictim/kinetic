/**
 * OpenTelemetry Service Implementation
 *
 * Wraps @opentelemetry/sdk-node with a simplified API
 * for Kinetic applications. Supports both traces and metrics.
 */

import {
  NodeTracerProvider,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import {
  PeriodicExportingMetricReader,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource, resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import {
  trace,
  Tracer,
  Span,
  context as otelContext,
  SpanStatusCode,
  metrics,
} from '@opentelemetry/api';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';

/**
 * Configuration for OpenTelemetry
 */
export interface OtelConfig {
  /**
   * Service name (required)
   */
  serviceName: string;

  /**
   * Service version
   * @default '0.1.0'
   */
  serviceVersion?: string;

  /**
   * Deployment environment
   * @default 'development'
   */
  environment?: 'development' | 'staging' | 'production' | string;

  /**
   * OTLP endpoint for traces
   * @default process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces'
   */
  tracesEndpoint?: string;

  /**
   * OTLP endpoint for metrics
   * @default process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics'
   */
  metricsEndpoint?: string;

  /**
   * Enable automatic HTTP instrumentation
   * @default true
   */
  autoInstrumentHttp?: boolean;

  /**
   * Sampling ratio (0.0 to 1.0)
   * @default 1.0
   */
  samplingRatio?: number;

  /**
   * Metric export interval in milliseconds
   * @default 60000
   */
  metricExportIntervalMs?: number;

  /**
   * Histogram buckets for latency metrics (in seconds)
   * @default [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
   */
  histogramBuckets?: number[];
}

/**
 * OpenTelemetry Service
 * Provides tracing and metrics capabilities
 */
export class OtelService {
  private tracerProvider: NodeTracerProvider | null = null;
  private meterProvider: MeterProvider | null = null;
  private config: Required<OtelConfig>;
  private tracer: Tracer;
  private activeSpans = new Map<
    string,
    { span: Span; end: () => void }
  >();
  private traceExporter: OTLPTraceExporter | null = null;
  private metricReader: PeriodicExportingMetricReader | null = null;

  constructor(config: OtelConfig) {
    this.config = { ...this.getDefaultConfig(), ...config };
    this.tracer = trace.getTracer('kinetic-otel', this.config.serviceVersion);
  }

  /**
   * Get default configuration values
   */
  private getDefaultConfig(): Required<OtelConfig> {
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    return {
      serviceName: 'unknown-service',
      serviceVersion: '0.1.0',
      environment: process.env.NODE_ENV || 'development',
      tracesEndpoint:
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
        (otlpEndpoint ? `${otlpEndpoint}/v1/traces` : 'http://localhost:4318/v1/traces'),
      metricsEndpoint:
        process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
        (otlpEndpoint ? `${otlpEndpoint}/v1/metrics` : 'http://localhost:4318/v1/metrics'),
      autoInstrumentHttp: true,
      samplingRatio: 1.0,
      metricExportIntervalMs: 60000,
      histogramBuckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    };
  }

  /**
   * Initialize the OpenTelemetry SDK
   * Call this once at application startup
   */
  async init(): Promise<void> {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: this.config.serviceName,
      [ATTR_SERVICE_VERSION]: this.config.serviceVersion,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: this.config.environment,
    });

    // Configure trace exporter
    this.traceExporter = new OTLPTraceExporter({
      url: this.config.tracesEndpoint,
    });

    // Initialize tracer provider with sampling
    this.tracerProvider = new NodeTracerProvider({
      resource,
      sampler: new TraceIdRatioBasedSampler(this.config.samplingRatio),
    });

    // Configure metric exporter and reader
    const metricExporter = new OTLPMetricExporter({
      url: this.config.metricsEndpoint,
    });

    this.metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: this.config.metricExportIntervalMs,
    });

    // Initialize meter provider
    this.meterProvider = new MeterProvider({
      resource,
      readers: [this.metricReader],
    });

    // Register auto-instrumentations
    if (this.config.autoInstrumentHttp) {
      registerInstrumentations({
        tracerProvider: this.tracerProvider,
        meterProvider: this.meterProvider,
        instrumentations: [
          new HttpInstrumentation({
            enabled: true,
          }),
        ],
      });
    }

    // Set global providers
    this.tracerProvider.register();
    metrics.setGlobalMeterProvider(this.meterProvider);

    // Update tracer after SDK starts
    this.tracer = trace.getTracer('kinetic-otel', this.config.serviceVersion);
  }

  /**
   * Shutdown the OpenTelemetry SDK
   * Call this before application exit
   */
  async shutdown(): Promise<void> {
    // End any active spans
    for (const [, ref] of this.activeSpans) {
      ref.span.setStatus({ code: SpanStatusCode.ERROR, message: 'Force ended on shutdown' });
      ref.end();
    }
    this.activeSpans.clear();

    // Shutdown providers
    if (this.metricReader) {
      await this.metricReader.shutdown();
      this.metricReader = null;
    }

    if (this.tracerProvider) {
      await this.tracerProvider.shutdown();
      this.tracerProvider = null;
    }

    if (this.meterProvider) {
      await this.meterProvider.shutdown();
      this.meterProvider = null;
    }

    if (this.traceExporter) {
      await this.traceExporter.shutdown();
      this.traceExporter = null;
    }
  }

  /**
   * Start a new span
   *
   * @param name - Span name
   * @param attributes - Initial span attributes
   * @returns Span reference with setAttribute and end methods
   */
  startSpan(
    name: string,
    attributes?: Record<string, unknown>
  ): {
    id: string;
    setAttribute: (key: string, value: unknown) => void;
    end: () => void;
  } {
    const span = this.tracer.startSpan(name);
    const id = crypto.randomUUID();

    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        this.setSpanAttribute(span, key, value);
      });
    }

    // Save to active spans
    const endFn = () => {
      span.end();
      this.activeSpans.delete(id);
    };

    this.activeSpans.set(id, { span, end: endFn });

    return {
      id,
      setAttribute: (key: string, value: unknown) => {
        this.setSpanAttribute(span, key, value);
      },
      end: endFn,
    };
  }

  /**
   * Set attribute on a span with proper typing
   */
  private setSpanAttribute(span: Span, key: string, value: unknown): void {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      span.setAttribute(key, value);
    } else if (typeof value === 'number') {
      span.setAttribute(key, value);
    } else if (typeof value === 'boolean') {
      span.setAttribute(key, value);
    } else if (Array.isArray(value)) {
      // Filter to only include string arrays for OTel compatibility
      const stringArray = value.filter((v): v is string => typeof v === 'string');
      if (stringArray.length === value.length) {
        span.setAttribute(key, stringArray);
      }
    } else {
      // Convert other types to string
      span.setAttribute(key, String(value));
    }
  }

  /**
   * Get the current trace context as a string
   * Useful for propagation to downstream services
   */
  getTraceContext(): { traceId: string; spanId: string } | null {
    const activeContext = otelContext.active();
    const span = trace.getSpan(activeContext);
    if (!span) {
      return null;
    }

    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }

  /**
   * Get a meter for recording metrics
   */
  getMeter() {
    return this.meterProvider?.getMeter('kinetic-otel', this.config.serviceVersion);
  }

  /**
   * Create a histogram metric for measuring durations
   */
  createDurationHistogram(name: string, description?: string) {
    const meter = this.getMeter();
    if (!meter) return null;

    return meter.createHistogram(name, {
      description: description || `${name} duration`,
      unit: 's',
    });
  }

  /**
   * Create a counter metric
   */
  createCounter(name: string, description?: string) {
    const meter = this.getMeter();
    if (!meter) return null;

    return meter.createCounter(name, {
      description: description || `${name} count`,
    });
  }

  /**
   * Create an up-down counter (gauge-like)
   */
  createUpDownCounter(name: string, description?: string) {
    const meter = this.getMeter();
    if (!meter) return null;

    return meter.createUpDownCounter(name, {
      description: description || `${name} value`,
    });
  }

  /**
   * Get service configuration
   */
  getConfig(): Readonly<OtelConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Check if SDK is initialized
   */
  isReady(): boolean {
    return this.tracerProvider !== null && this.meterProvider !== null;
  }
}
