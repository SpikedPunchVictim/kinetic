/**
 * Observability Demo Example (Enhanced with OpenTelemetry)
 * Demonstrates: Core observability + Real OpenTelemetry integration
 *
 * Features:
 * - Built-in observability: In-memory logging, metrics, health checks
 * - OpenTelemetry: Distributed tracing with OTLP export
 * - Automatic HTTP instrumentation via OTel middleware
 * - Manual span creation for custom operations
 */

import { z } from 'zod';
import {
  createApp,
  FrameworkError,
  ErrorCodes,
} from '@klusterio/kinetic-core';
import {
  defineModel,
  wrapSuccess,
  wrapError,
} from '@klusterio/kinetic-core/schema';
import {
  createLogger,
  Metrics,
  Health,
  tracer as coreTracer,
} from '@klusterio/kinetic-core/observability';
import {
  trackError,
  getErrorsIntrospection,
  registerIntrospectionRoutes,
} from '@klusterio/kinetic-core/ai-dev';
import { OtelAddon } from '@klusterio/addon-otel';

console.log('📊 Observability Demo Example (Enhanced with OpenTelemetry)\n');

// ============================================================================
// 1. OpenTelemetry Setup
// ============================================================================

console.log('🔧 Setting up OpenTelemetry...');

const otel = await OtelAddon.create({
  serviceName: 'observability-demo',
  serviceVersion: '1.0.0',
  environment: 'development',
  // OTLP endpoints - set env vars or use defaults
  tracesEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || 'http://localhost:4318/v1/traces',
  metricsEndpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || 'http://localhost:4318/v1/metrics',
  // Auto-instrument HTTP calls
  autoInstrumentHttp: true,
  // Sample 100% in development
  samplingRatio: 1.0,
  // Export metrics every 30 seconds
  metricExportIntervalMs: 30000,
});

console.log('✅ OpenTelemetry initialized');
console.log(`   Traces: ${otel.getConfig().tracesEndpoint}`);
console.log(`   Metrics: ${otel.getConfig().metricsEndpoint}`);
console.log(`   Service: ${otel.getConfig().serviceName}`);

// ============================================================================
// 2. Custom Logger Configuration
// ============================================================================

const logger = createLogger({
  level: 'debug',
  format: 'pretty',
});

logger.info('Starting observability demo');

// ============================================================================
// 3. Custom Health Checks
// ============================================================================

Health.register({
  name: 'database',
  check: async () => {
    const connected = true;
    return connected
      ? { status: 'up', details: { connections: 5, latency: '2ms' } }
      : { status: 'down', details: { error: 'Connection refused' } };
  },
});

Health.register({
  name: 'otel',
  check: async () => {
    return otel.isReady()
      ? { status: 'up', details: { ready: true } }
      : { status: 'down', details: { ready: false } };
  },
});

Health.register({
  name: 'cache',
  check: () => {
    const hitRate = 0.85;
    return {
      status: 'up',
      details: { hitRate, size: 1024 },
    };
  },
});

// ============================================================================
// 4. In-Memory Store with Dual Tracing
// ============================================================================

class InstrumentedStore {
  constructor(name) {
    this.name = name;
    this.data = new Map();
  }

  async create(record) {
    // Create OTel span for the operation
    const otelSpan = otel.startSpan(`store.${this.name}.create`, {
      'db.table': this.name,
      'db.operation': 'INSERT',
    });

    // Also use core tracer for comparison
    const coreSpan = coreTracer.startSpan(`store.${this.name}.create`);

    try {
      Metrics.counter('store.create').inc(1, { store: this.name });

      const id = crypto.randomUUID();
      const newRecord = { ...record, id, createdAt: new Date() };
      this.data.set(id, newRecord);

      logger.info(`Created ${this.name}`, { id });

      // Set attributes on OTel span
      otelSpan.setAttribute('db.rows_affected', 1);
      otelSpan.setAttribute('entity.id', id);

      coreTracer.endSpan(coreSpan, 'ok');
      otelSpan.end();

      return newRecord;
    } catch (err) {
      coreTracer.endSpan(coreSpan, 'error');
      otelSpan.setAttribute('error', true);
      otelSpan.setAttribute('error.message', err.message);
      otelSpan.end();

      trackError({
        code: 'STORE_CREATE_ERROR',
        message: err.message,
        suggestion: 'Check store capacity',
      });
      throw err;
    }
  }

  async findAll() {
    const otelSpan = otel.startSpan(`store.${this.name}.findAll`, {
      'db.table': this.name,
      'db.operation': 'SELECT',
    });

    Metrics.counter('store.findAll').inc(1, { store: this.name });

    const result = Array.from(this.data.values());

    // Set result count
    otelSpan.setAttribute('db.rows_returned', result.length);
    otelSpan.end();

    return result;
  }

  async findById(id) {
    const otelSpan = otel.startSpan(`store.${this.name}.findById`, {
      'db.table': this.name,
      'db.operation': 'SELECT',
      'db.query': `SELECT * FROM ${this.name} WHERE id = ?`,
    });

    const result = this.data.get(id);

    otelSpan.setAttribute('db.rows_returned', result ? 1 : 0);
    otelSpan.setAttribute('cache.hit', !!result);
    otelSpan.end();

    return result || null;
  }

  async getMetrics() {
    return {
      name: this.name,
      size: this.data.size,
    };
  }
}

// ============================================================================
// 5. Metrics with OTel
// ============================================================================

const requestCounter = otel.createCounter('http_requests_total', 'Total HTTP requests');
const requestDuration = otel.createDurationHistogram('http_request_duration_seconds', 'HTTP request latency');

// ============================================================================
// 6. Models
// ============================================================================

const ProductModel = defineModel({
  name: 'Product',
  fields: {
    id: z.string().uuid(),
    name: z.string().min(1),
    price: z.number().positive(),
    stock: z.number().int().min(0),
    category: z.string(),
    createdAt: z.date(),
  },
});

// ============================================================================
// 7. Create Application with OTel Context
// ============================================================================

const app = await createApp({
  createAppContext: async () => ({ otel }),
});

// Register OTel middleware for automatic HTTP tracing
await OtelAddon.registerHooks(app, otel, {
  captureHeaders: true,
  headerAllowList: ['x-request-id', 'x-correlation-id', 'user-agent'],
  skipPaths: ['/health', '/__introspect/*'],
});

console.log('✅ OTel middleware registered');

const productStore = new InstrumentedStore('Product');

// Seed data
await productStore.create({ name: 'Laptop', price: 999, stock: 10, category: 'electronics' });
await productStore.create({ name: 'Keyboard', price: 49, stock: 50, category: 'accessories' });

// ============================================================================
// 8. Routes with Full Observability
// ============================================================================

const routes = [
  // Health endpoint
  {
    method: 'GET',
    path: '/health',
    handler: async () => {
      const health = await Health.check();
      return health;
    },
  },

  // OTel status
  {
    method: 'GET',
    path: '/otel/status',
    handler: async () => ({
      ready: otel.isReady(),
      config: {
        serviceName: otel.getConfig().serviceName,
        serviceVersion: otel.getConfig().serviceVersion,
        environment: otel.getConfig().environment,
        samplingRatio: otel.getConfig().samplingRatio,
      },
    }),
  },

  // Manual span creation demo
  {
    method: 'GET',
    path: '/otel/manual-span',
    handler: async () => {
      const span = otel.startSpan('manual-operation', {
        'operation.type': 'demo',
        'demo.version': '1.0.0',
      });

      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 50));

      span.setAttribute('operation.completed', true);
      span.setAttribute('operation.duration_ms', 50);
      span.end();

      return wrapSuccess({
        message: 'Manual span created - check your OTLP collector!',
        traceContext: otel.getTraceContext(),
      });
    },
  },

  // withSpan helper demo
  {
    method: 'POST',
    path: '/otel/with-span',
    handler: async (request) => {
      const result = await OtelAddon.withSpan(otel, 'process-payment', async () => {
        // Simulate payment processing
        await new Promise(resolve => setTimeout(resolve, 100));

        const { amount, currency } = request.body;

        // Record custom metrics
        const paymentAmount = otel.createCounter('payment_total', 'Total payment amount');
        paymentAmount?.add(amount, { currency });

        return {
          paymentId: crypto.randomUUID(),
          amount,
          currency,
          status: 'completed',
        };
      });

      return wrapSuccess(result);
    },
  },

  // Metrics comparison (Core vs OTel)
  {
    method: 'GET',
    path: '/metrics/comparison',
    handler: async () => {
      const coreMetrics = Metrics.getAll();

      return wrapSuccess({
        source: 'mixed',
        core: coreMetrics,
        otel: {
          // OTel metrics are exported via OTLP
          note: 'OTel metrics are exported to OTLP collector',
          endpoints: {
            traces: otel.getConfig().tracesEndpoint,
            metrics: otel.getConfig().metricsEndpoint,
          },
        },
      });
    },
  },

  // Core tracer spans
  {
    method: 'GET',
    path: '/trace',
    handler: async () => {
      const span = coreTracer.startSpan('custom.trace', { endpoint: '/trace' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      coreTracer.endSpan(span, 'ok');

      const spans = coreTracer.getSpans();
      return wrapSuccess({
        spanCount: spans.length,
        spans: spans.map((s) => ({
          name: s.name,
          duration: s.endTime ? s.endTime - s.startTime : 'incomplete',
        })),
      });
    },
  },

  // Error tracking
  {
    method: 'POST',
    path: '/error-demo',
    handler: async (request) => {
      const { code, message } = request.body;

      const error = new FrameworkError({
        code: code || 'DEMO_ERROR',
        message: message || 'Demo error occurred',
        suggestion: 'This is a test error',
      });

      trackError({
        code: error.code,
        message: error.message,
        suggestion: error.suggestion,
      });

      return wrapSuccess(getErrorsIntrospection());
    },
  },

  // View errors
  {
    method: 'GET',
    path: '/errors',
    handler: async () => wrapSuccess(getErrorsIntrospection()),
  },

  // Application logs
  {
    method: 'GET',
    path: '/logs',
    handler: async () => ({
      logs: logger.getRecent(20),
    }),
  },

  // Product CRUD with OTel instrumentation
  {
    method: 'POST',
    path: '/products',
    handler: async (request) => {
      const startTime = Date.now();
      const otelSpan = otel.startSpan('api.product.create', {
        'http.method': 'POST',
        'http.route': '/products',
      });

      try {
        const product = await productStore.create(request.body);
        logger.info('Product created via API', { productId: product.id });

        // Record metrics
        requestCounter?.add(1, { method: 'POST', route: '/products', status: 'success' });

        otelSpan.setAttribute('entity.id', product.id);
        otelSpan.end();

        // Record duration
        const duration = (Date.now() - startTime) / 1000;
        requestDuration?.record(duration, { method: 'POST', route: '/products' });

        return wrapSuccess(product);
      } catch (err) {
        otelSpan.setAttribute('error', true);
        otelSpan.setAttribute('error.message', err.message);
        otelSpan.end();

        requestCounter?.add(1, { method: 'POST', route: '/products', status: 'error' });
        throw err;
      }
    },
  },

  {
    method: 'GET',
    path: '/products',
    handler: async () => {
      const span = otel.startSpan('api.product.list', {
        'http.method': 'GET',
        'http.route': '/products',
      });

      const products = await productStore.findAll();

      span.setAttribute('db.rows_returned', products.length);
      span.end();

      requestCounter?.add(1, { method: 'GET', route: '/products', status: 'success' });

      return wrapSuccess(products);
    },
  },

  {
    method: 'GET',
    path: '/products/:id',
    handler: async (request) => {
      const span = otel.startSpan('api.product.get-by-id', {
        'http.method': 'GET',
        'http.route': '/products/:id',
        'entity.id': request.params.id,
      });

      const product = await productStore.findById(request.params.id);

      if (!product) {
        span.setAttribute('error', true);
        span.setAttribute('error.message', 'Product not found');
        span.end();
        throw new Error('Product not found');
      }

      span.end();
      return wrapSuccess(product);
    },
  },

  // Intentional error
  {
    method: 'GET',
    path: '/cause-error',
    handler: async () => {
      const span = otel.startSpan('api.error.trigger');
      try {
        throw new Error('Intentional error for testing');
      } catch (err) {
        span.setAttribute('error', true);
        span.setAttribute('error.message', err.message);
        span.end();

        trackError({
          code: 'INTENTIONAL_ERROR',
          message: err.message,
          suggestion: 'This is expected in demo',
        });

        return wrapError({
          code: 'CAUGHT_ERROR',
          message: 'Error was logged and tracked',
          suggestion: 'Check /errors endpoint',
        });
      }
    },
  },
];

// Register routes directly on Fastify
for (const route of routes) {
  app.route(route);
}

// Register introspection routes
registerIntrospectionRoutes(app, {
  routes,
  models: [ProductModel],
});

console.log('📡 Routes registered:', routes.length);

// ============================================================================
// 9. Graceful Shutdown
// ============================================================================

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await otel.shutdown();
  await app.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await otel.shutdown();
  await app.close();
  process.exit(0);
});

// ============================================================================
// 10. Start Server
// ============================================================================

await app.ready();
await app.listen({ port: 3003, host: '127.0.0.1' });

console.log('\n✅ Observability Demo running with OpenTelemetry!');
console.log(`\n📡 API Endpoints:`);
console.log(`   GET  http://127.0.0.1:3003/health         (includes OTel health check)`);
console.log(`   GET  http://127.0.0.1:3003/otel/status   (OTel configuration)`);
console.log(`   GET  http://127.0.0.1:3003/otel/manual-span   (manual span demo)`);
console.log(`   POST http://127.0.0.1:3003/otel/with-span     (withSpan helper demo)`);
console.log(`   GET  http://127.0.0.1:3003/metrics/comparison (Core vs OTel comparison)`);
console.log(`   GET  http://127.0.0.1:3003/metrics       (application metrics)`);
console.log(`   GET  http://127.0.0.1:3003/trace         (core tracer spans)`);
console.log(`   POST http://127.0.0.1:3003/products      (OTel-instrumented)`);
console.log(`   GET  http://127.0.0.1:3003/products      (OTel-instrumented)`);
console.log(`\n🔍 Introspection endpoints:`);
console.log(`   http://127.0.0.1:3003/__introspect/routes`);
console.log(`   http://127.0.0.1:3003/__introspect/schema`);
console.log(`\n📊 OpenTelemetry:`);
console.log(`   Traces are exported to: ${otel.getConfig().tracesEndpoint}`);
console.log(`   Metrics are exported to: ${otel.getConfig().metricsEndpoint}`);
console.log(`\n📝 To view traces, ensure you have an OTLP collector running on port 4318`);
console.log(`   Example with Jaeger: docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest`);
console.log(`   Then visit: http://localhost:16686`);

export { app, logger, Metrics, Health, otel };
