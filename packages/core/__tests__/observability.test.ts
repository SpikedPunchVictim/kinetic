import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createLogger,
  Logger,
  LogContext,
  Metrics,
  Health,
  tracer,
} from '../src/observability/index.js';

describe('Observability Module', () => {
  describe('createLogger', () => {
    let logs: string[] = [];
    let mockStream: { write: (data: string) => void };

    beforeEach(() => {
      logs = [];
      mockStream = {
        write: (data: string) => logs.push(data),
      };
    });

    it('should create a logger with default options', () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should log messages at appropriate levels', () => {
      const logger = createLogger({ format: 'json', destination: mockStream as NodeJS.WritableStream });

      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(logs).toHaveLength(3);
      expect(logs[0]).toContain('Info message');
      expect(logs[0]).toContain('"level":"info"');
      expect(logs[1]).toContain('Warning message');
      expect(logs[2]).toContain('Error message');
    });

    it('should respect log level filtering', () => {
      const logger = createLogger({
        level: 'warn',
        format: 'json',
        destination: mockStream as NodeJS.WritableStream,
      });

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('Warning message');
    });

    it('should include context in log entries', () => {
      const logger = createLogger({ format: 'json', destination: mockStream as NodeJS.WritableStream });

      logger.info('Message with context', { userId: '123', action: 'login' });

      const log = JSON.parse(logs[0]);
      expect(log.msg).toBe('Message with context');
      expect(log.userId).toBe('123');
      expect(log.action).toBe('login');
    });

    it('should support error logging with Error object', () => {
      const logger = createLogger({ format: 'json', destination: mockStream as NodeJS.WritableStream });
      const error = new Error('Something went wrong');

      logger.error('Operation failed', error);

      const log = JSON.parse(logs[0]);
      expect(log.msg).toBe('Operation failed');
      expect(log.error.message).toBe('Something went wrong');
    });

    it('should create child loggers with additional context', () => {
      const parentLogger = createLogger({
        format: 'json',
        destination: mockStream as NodeJS.WritableStream,
      });
      const childLogger = parentLogger.child({ requestId: 'abc-123' });

      childLogger.info('Child message');

      const log = JSON.parse(logs[0]);
      expect(log.requestId).toBe('abc-123');
    });

    it('should output pretty format when specified', () => {
      const logger = createLogger({
        level: 'info',
        format: 'pretty',
        destination: mockStream as NodeJS.WritableStream,
      });

      logger.info('Pretty message');

      expect(logs[0]).toContain('[INFO]');
      expect(logs[0]).toContain('Pretty message');
    });

    it('should include timestamp in logs', () => {
      const logger = createLogger({ format: 'json', destination: mockStream as NodeJS.WritableStream });

      logger.info('Test');

      const log = JSON.parse(logs[0]);
      expect(log.time).toBeDefined();
      expect(new Date(log.time).toISOString()).toBe(log.time);
    });
  });

  describe('Metrics', () => {
    beforeEach(() => {
      Metrics.clear();
    });

    it('should create and increment counters', () => {
      const counter = Metrics.counter('http_requests');
      counter.inc();
      counter.inc();
      counter.inc(3);

      expect(counter.get()).toBe(5);
    });

    it('should return same counter for same name', () => {
      const counter1 = Metrics.counter('test_counter');
      const counter2 = Metrics.counter('test_counter');

      counter1.inc();
      expect(counter2.get()).toBe(1);
    });

    it('should track counter with labels', () => {
      const counter = Metrics.counter('api_calls');
      counter.inc(1, { method: 'GET' });
      counter.inc(2, { method: 'POST' });

      // Total should include all labels
      expect(counter.get()).toBe(3);
    });

    it('should create histograms', () => {
      const histogram = Metrics.histogram('response_time', [100, 200, 500, 1000]);

      histogram.observe(50);
      histogram.observe(150);
      histogram.observe(600);

      const stats = histogram.get();
      expect(stats.count).toBe(3);
      expect(stats.sum).toBe(800);
    });

    it('should track histogram buckets', () => {
      const histogram = Metrics.histogram('latency');
      histogram.observe(0.01);
      histogram.observe(0.1);
      histogram.observe(1.0);

      const stats = histogram.get();
      expect(stats.buckets[0.01]).toBe(1);
      expect(stats.buckets[0.1]).toBe(2);
    });

    it('should get all counter metrics', () => {
      Metrics.counter('metric_a').inc(5);
      Metrics.counter('metric_b').inc(10);

      const all = Metrics.getAll();
      expect(all.metric_a).toBe(5);
      expect(all.metric_b).toBe(10);
    });

    it('should clear all metrics', () => {
      Metrics.counter('to_clear').inc(5);
      Metrics.clear();

      const counter = Metrics.counter('to_clear');
      expect(counter.get()).toBe(0);
    });
  });

  describe('Health', () => {
    beforeEach(() => {
      // Unregister any test-specific checks
      Health.unregister('temp_check');
      Health.unregister('async_service');
      Health.unregister('failing_service');
      Health.unregister('degraded_service');
      Health.unregister('database');
    });

    afterEach(() => {
      // Clean up after tests
      Health.unregister('temp_check');
      Health.unregister('async_service');
      Health.unregister('failing_service');
      Health.unregister('degraded_service');
      Health.unregister('database');
    });

    it('should register and run health checks', async () => {
      Health.register({
        name: 'database',
        check: () => ({ status: 'up', details: { connections: 5 } }),
      });

      const result = await Health.check();

      expect(result.status).toBe('healthy');
      expect(result.checks.app.status).toBe('up');
      expect(result.checks.database.status).toBe('up');
      expect(result.checks.database.details.connections).toBe(5);
    });

    it('should report unhealthy when any check fails', async () => {
      Health.register({
        name: 'degraded_service',
        check: () => ({ status: 'down', details: { reason: 'Timeout' } }),
      });

      const result = await Health.check();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.degraded_service.status).toBe('down');
    });

    it('should include timestamp in health check', async () => {
      const beforeCheck = Date.now();
      const result = await Health.check();
      const afterCheck = Date.now();

      const checkTime = new Date(result.timestamp).getTime();
      expect(checkTime).toBeGreaterThanOrEqual(beforeCheck);
      expect(checkTime).toBeLessThanOrEqual(afterCheck);
    });

    it('should handle async health checks', async () => {
      Health.register({
        name: 'async_service',
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { status: 'up' };
        },
      });

      const result = await Health.check();

      expect(result.status).toBe('healthy');
      expect(result.checks.async_service.status).toBe('up');
    });

    it('should mark check down when it throws', async () => {
      Health.register({
        name: 'failing_service',
        check: () => {
          throw new Error('Service crashed');
        },
      });

      const result = await Health.check();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.failing_service.status).toBe('down');
      expect(result.checks.failing_service.details.error).toContain('Service crashed');
    });

    it('should unregister health checks', async () => {
      Health.register({ name: 'temp_check', check: () => ({ status: 'up' }) });
      Health.unregister('temp_check');

      const result = await Health.check();
      expect(result.checks.temp_check).toBeUndefined();
    });
  });

  describe('tracer', () => {
    beforeEach(() => {
      tracer.clear();
    });

    it('should create spans', () => {
      const span = tracer.startSpan('test-operation', { userId: '123' });

      expect(span.name).toBe('test-operation');
      expect(span.attributes.userId).toBe('123');
      expect(span.status).toBe('ok');
      expect(span.startTime).toBeGreaterThan(0);
    });

    it('should end spans', () => {
      const span = tracer.startSpan('test');
      const beforeEnd = Date.now();
      tracer.endSpan(span, 'ok');

      expect(span.endTime).toBeGreaterThanOrEqual(beforeEnd);
      expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
    });

    it('should track span status', () => {
      const span = tracer.startSpan('error-operation');
      tracer.endSpan(span, 'error');

      expect(span.status).toBe('error');
    });

    it('should retrieve all spans', () => {
      tracer.startSpan('span1');
      tracer.startSpan('span2');

      const spans = tracer.getSpans();
      expect(spans).toHaveLength(2);
      expect(spans[0].name).toBe('span1');
      expect(spans[1].name).toBe('span2');
    });

    it('should clear spans', () => {
      tracer.startSpan('to-clear');
      tracer.clear();

      expect(tracer.getSpans()).toHaveLength(0);
    });
  });
});
