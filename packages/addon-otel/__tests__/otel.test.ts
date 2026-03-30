import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OtelAddon, createOtel } from '../src/index.js';
import { OtelConfig } from '../src/otel-service.js';

describe('OpenTelemetry Addon', () => {
  // Helper to create a valid config for testing
  const createValidConfig = (): OtelConfig => ({
    serviceName: 'test-service',
    environment: 'development',
    tracesEndpoint: 'http://localhost:4318/v1/traces',
    metricsEndpoint: 'http://localhost:4318/v1/metrics',
    // Disable HTTP instrumentation for tests to prevent side effects
    autoInstrumentHttp: false,
  });

  describe('OtelAddon factory', () => {
    it('should create OTel service with create()', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      expect(otel).toBeDefined();
      expect(typeof otel.startSpan).toBe('function');
      expect(typeof otel.shutdown).toBe('function');
      expect(typeof otel.createCounter).toBe('function');
      expect(typeof otel.createDurationHistogram).toBe('function');
      expect(otel.isReady()).toBe(true);

      // Cleanup
      await otel.shutdown();
    });

    it('should apply custom configuration', async () => {
      const otel = await OtelAddon.create({
        serviceName: 'my-service',
        serviceVersion: '1.2.3',
        environment: 'staging',
        tracesEndpoint: 'http://custom:4318/v1/traces',
        metricsEndpoint: 'http://custom:4318/v1/metrics',
        samplingRatio: 0.5,
        metricExportIntervalMs: 30000,
        histogramBuckets: [0.1, 0.5, 1, 2, 5],
        autoInstrumentHttp: false,
      });

      const config = otel.getConfig();
      expect(config.serviceName).toBe('my-service');
      expect(config.serviceVersion).toBe('1.2.3');
      expect(config.environment).toBe('staging');
      expect(config.tracesEndpoint).toBe('http://custom:4318/v1/traces');
      expect(config.metricsEndpoint).toBe('http://custom:4318/v1/metrics');
      expect(config.samplingRatio).toBe(0.5);
      expect(config.metricExportIntervalMs).toBe(30000);
      expect(config.histogramBuckets).toEqual([0.1, 0.5, 1, 2, 5]);

      await otel.shutdown();
    });
  });

  describe('Span operations', () => {
    it('should create spans with attributes', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      const span = otel.startSpan('test-operation', {
        'custom.attribute': 'value',
        'http.method': 'GET',
      });

      expect(span).toBeDefined();
      expect(span.id).toBeDefined();
      expect(typeof span.setAttribute).toBe('function');
      expect(typeof span.end).toBe('function');

      span.setAttribute('later.attribute', true);
      span.end();

      await otel.shutdown();
    });

    it('should create nested spans', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      const parentSpan = otel.startSpan('parent');
      const childSpan = otel.startSpan('child', { 'parent.id': parentSpan.id });

      expect(parentSpan.id).not.toBe(childSpan.id);

      childSpan.end();
      parentSpan.end();

      await otel.shutdown();
    });
  });

  describe('withSpan helper', () => {
    it('should wrap operations in spans', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      const result = await OtelAddon.withSpan(otel, 'database-query', async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: 'test-data' };
      });

      expect(result).toEqual({ data: 'test-data' });

      await otel.shutdown();
    });

    it('should capture errors in spans', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      await expect(
        OtelAddon.withSpan(otel, 'failing-operation', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      await otel.shutdown();
    });
  });

  describe('createOtel convenience function', () => {
    it('should work as an alias for OtelAddon.create', async () => {
      const otel = await createOtel(createValidConfig());

      expect(otel).toBeDefined();
      expect(otel.isReady()).toBe(true);

      await otel.shutdown();
    });
  });

  describe('Metrics', () => {
    it('should create a counter metric', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      const counter = otel.createCounter('test_counter', 'Test counter description');
      expect(counter).toBeDefined();
      expect(typeof counter?.add).toBe('function');

      await otel.shutdown();
    });

    it('should create a histogram metric', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      const histogram = otel.createDurationHistogram('test_duration', 'Test duration description');
      expect(histogram).toBeDefined();
      expect(typeof histogram?.record).toBe('function');

      await otel.shutdown();
    });

    it('should create an up-down counter', async () => {
      const otel = await OtelAddon.create(createValidConfig());

      const counter = otel.createUpDownCounter('test_gauge', 'Test gauge description');
      expect(counter).toBeDefined();
      expect(typeof counter?.add).toBe('function');

      await otel.shutdown();
    });
  });

  describe('Configuration', () => {
    it('should use environment variables for endpoints', async () => {
      // Mock environment variable
      const originalEnv = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-based:4318';

      const otel = await OtelAddon.create({
        serviceName: 'env-test',
        autoInstrumentHttp: false,
      });

      const config = otel.getConfig();
      expect(config.tracesEndpoint).toBe('http://env-based:4318/v1/traces');
      expect(config.metricsEndpoint).toBe('http://env-based:4318/v1/metrics');

      await otel.shutdown();

      // Restore environment
      if (originalEnv) {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv;
      } else {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      }
    });
  });
});

describe('OtelService lifecycle', () => {
  const createValidConfig = (): OtelConfig => ({
    serviceName: 'lifecycle-test',
    autoInstrumentHttp: false,
    tracesEndpoint: 'http://localhost:4318/v1/traces',
    metricsEndpoint: 'http://localhost:4318/v1/metrics',
  });

  it('should shut down cleanly', async () => {
    const otel = await OtelAddon.create(createValidConfig());

    expect(otel.isReady()).toBe(true);

    // Create some spans
    const span1 = otel.startSpan('span1');
    const span2 = otel.startSpan('span2');

    // Shutdown should end active spans
    await otel.shutdown();

    expect(otel.isReady()).toBe(false);
  });
});
