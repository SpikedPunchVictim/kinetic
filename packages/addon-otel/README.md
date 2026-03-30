# @klusterio/addon-otel

OpenTelemetry addon for the Kinetic Framework. Provides distributed tracing, metrics collection, and observability for Fastify applications using OpenTelemetry standards.

## Features

- **Distributed Tracing**: Automatic HTTP request tracing with manual span creation
- **Metrics Collection**: Counters, histograms, and up-down counters
- **OTLP Export**: Native support for OpenTelemetry Protocol (OTLP) exporters
- **Auto-Instrumentation**: Automatic HTTP instrumentation via `@opentelemetry/instrumentation-http`
- **Sampling Control**: Configurable trace sampling ratios (0.0 - 1.0)
- **Resource Attributes**: Automatic service name, version, and environment tagging

## Installation

```bash
npm install @klusterio/addon-otel
# or
pnpm add @klusterio/addon-otel
```

## Quick Start

```typescript
import { createApp } from '@klusterio/kinetic-core';
import { OtelAddon } from '@klusterio/addon-otel';

// Create OTel service
const otel = await OtelAddon.create({
  serviceName: 'my-service',
  serviceVersion: '1.0.0',
  environment: 'production',
  tracesEndpoint: 'http://localhost:4318/v1/traces',
  metricsEndpoint: 'http://localhost:4318/v1/metrics',
});

// Create app with OTel in context
const app = await createApp<{ otel: typeof otel }>({
  createAppContext: async () => ({ otel }),
});

// Register automatic request tracing
await OtelAddon.registerHooks(app, otel);

// Your routes here...
app.get('/users', async (req) => {
  // Access tracer anywhere via context
  const span = req.appContext.otel.startSpan('list-users');
  try {
    const users = await db.query('SELECT * FROM users');
    span.setAttribute('user.count', users.length);
    return users;
  } finally {
    span.end();
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await otel.shutdown();
  await app.close();
});
```

## Configuration

```typescript
interface OtelConfig {
  serviceName: string;                    // Required: Service identifier
  serviceVersion?: string;                // Default: '0.1.0'
  environment?: string;                     // Default: process.env.NODE_ENV
  tracesEndpoint?: string;                  // OTLP traces endpoint
  metricsEndpoint?: string;                 // OTLP metrics endpoint
  autoInstrumentHttp?: boolean;             // Default: true
  samplingRatio?: number;                  // Default: 1.0 (0.0 - 1.0)
  metricExportIntervalMs?: number;         // Default: 60000
  histogramBuckets?: number[];             // Custom histogram buckets
}
```

### Environment Variables

The addon respects standard OTel environment variables:

```bash
# Base endpoint for both traces and metrics
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Or set individually
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics

# Sampling (0.0 to 1.0)
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.5
```

## Usage Examples

### Automatic Request Tracing

```typescript
import { OtelAddon } from '@klusterio/addon-otel';

// Register middleware for automatic tracing
await OtelAddon.registerHooks(fastify, otel, {
  captureHeaders: true,
  headerAllowList: ['x-request-id', 'x-correlation-id'],
  skipPaths: ['/health', '/metrics'],
});
```

### Manual Span Creation

```typescript
// Simple span
const span = otel.startSpan('database-query', {
  'db.table': 'users',
  'db.operation': 'SELECT',
});

try {
  const results = await db.query('SELECT * FROM users');
  span.setAttribute('db.rows', results.length);
} catch (error) {
  span.setAttribute('error', true);
  span.setAttribute('error.message', error.message);
  throw error;
} finally {
  span.end();
}
```

### With Span Helper

```typescript
import { OtelAddon } from '@klusterio/addon-otel';

// Wrap operations in spans automatically
const result = await OtelAddon.withSpan(otel, 'process-payment', async () => {
  const payment = await processPayment(data);
  return payment;
});
```

### Custom Metrics

```typescript
// Counter
const requestCounter = otel.createCounter('http_requests_total', 'Total HTTP requests');
requestCounter?.add(1, { method: 'GET', route: '/users' });

// Histogram (for latencies)
const latencyHistogram = otel.createDurationHistogram(
  'http_request_duration_seconds',
  'HTTP request latency'
);
const startTime = Date.now();
await handleRequest();
latencyHistogram?.record((Date.now() - startTime) / 1000);

// Up-Down Counter (for gauges)
const activeConnections = otel.createUpDownCounter(
  'active_connections',
  'Currently active connections'
);
activeConnections?.add(1);  // connection opened
activeConnections?.add(-1); // connection closed
```

### Middleware Options

```typescript
interface TraceMiddlewareOptions {
  captureBody?: boolean;           // Include request body (default: false)
  captureHeaders?: boolean;        // Include headers (default: false)
  headerAllowList?: string[];     // Headers to capture (supports wildcards)
  skipPaths?: string[];            // Skip tracing for these paths
  spanName?: (req) => string;      // Custom span name function
}
```

## API Reference

### OtelAddon

#### `create(config: OtelConfig): Promise<OtelService>`

Creates and initializes an OTel service instance.

#### `registerHooks(fastify: FastifyInstance, otelService: OtelService, options?: TraceMiddlewareOptions): Promise<void>`

Registers Fastify hooks for automatic request tracing.

#### `withSpan<T>(otelService: OtelService, name: string, operation: () => Promise<T>): Promise<T>`

Wraps an async operation in a span with automatic error capture.

#### `middleware(otelService: OtelService, options?: TraceMiddlewareOptions)`

Returns middleware function for manual route registration.

### OtelService

#### `startSpan(name: string, attributes?: Record<string, unknown>): Span`

Creates a new span with optional initial attributes.

Returns:
```typescript
{
  id: string;
  setAttribute: (key: string, value: unknown) => void;
  end: () => void;
}
```

#### `getTraceContext(): { traceId: string; spanId: string } | null`

Returns the current trace context for propagation to downstream services.

#### `createCounter(name: string, description?: string): Counter | null`

Creates a counter metric.

#### `createDurationHistogram(name: string, description?: string): Histogram | null`

Creates a histogram metric for latency measurements.

#### `createUpDownCounter(name: string, description?: string): UpDownCounter | null`

Creates an up-down counter for gauge-like metrics.

#### `isReady(): boolean`

Returns true if the OTel SDK is initialized.

#### `shutdown(): Promise<void>`

Gracefully shuts down the SDK, flushing pending telemetry.

## Development

### Running Tests

```bash
pnpm test
```

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

## Troubleshooting

### No Traces Appearing

1. Check endpoint URL is correct
2. Verify sampling ratio is above 0
3. Ensure `service.init()` was called before creating spans
4. Check network connectivity to collector

### High Memory Usage

1. Reduce `metricExportIntervalMs` (more frequent export)
2. Enable sampling: `samplingRatio: 0.1`
3. Check for unclosed spans

### TypeScript Errors

Ensure all peer dependencies are installed:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node
```

## License

MIT