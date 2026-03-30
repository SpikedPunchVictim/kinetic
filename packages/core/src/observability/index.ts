/**
 * Observability submodule
 * Logging, metrics, tracing, and health checks
 */

// ============================================================================
// Logger Types
// ============================================================================

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  trace: (msg: string, ctx?: LogContext) => void;
  debug: (msg: string, ctx?: LogContext) => void;
  info: (msg: string, ctx?: LogContext) => void;
  warn: (msg: string, ctx?: LogContext) => void;
  error: (msg: string, err?: Error | LogContext, ctx?: LogContext) => void;
  fatal: (msg: string, err?: Error | LogContext, ctx?: LogContext) => void;
  child: (bindings: LogContext) => Logger;
}

export interface LoggerOptions {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  format?: 'json' | 'pretty';
  destination?: NodeJS.WritableStream;
}

// ============================================================================
// Logger Implementation
// ============================================================================

const LOG_LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

class LoggerImpl implements Logger {
  private level: number;
  private format: 'json' | 'pretty';
  private destination: NodeJS.WritableStream;
  private bindings: LogContext;

  constructor(options: LoggerOptions = {}, bindings: LogContext = {}) {
    this.level = LOG_LEVELS[options.level ?? 'info'];
    this.format = options.format ?? 'json';
    this.destination = options.destination ?? process.stdout;
    this.bindings = bindings;
  }

  private log(level: string, levelNum: number, msg: string, ...args: unknown[]): void {
    if (levelNum < this.level) return;

    const timestamp = new Date().toISOString();
    const context: LogContext = { ...this.bindings };

    // Process arguments
    let error: Error | undefined;
    let extraContext: LogContext = {};

    for (const arg of args) {
      if (arg instanceof Error) {
        error = arg;
      } else if (typeof arg === 'object' && arg !== null) {
        extraContext = { ...extraContext, ...arg };
      }
    }

    const logEntry = {
      level,
      time: timestamp,
      msg,
      ...context,
      ...extraContext,
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    };

    if (this.format === 'json') {
      this.destination.write(JSON.stringify(logEntry) + '\n');
    } else {
      const color = this.getColor(level);
      const prefix = `${color}[${level.toUpperCase()}]\x1b[0m`;
      this.destination.write(`${timestamp} ${prefix} ${msg}\n`);
      if (error) {
        this.destination.write(`  Error: ${error.message}\n`);
      }
    }
  }

  private getColor(level: string): string {
    const colors: Record<string, string> = {
      trace: '\x1b[90m',
      debug: '\x1b[36m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      fatal: '\x1b[35m',
    };
    return colors[level] ?? '\x1b[0m';
  }

  trace(msg: string, ctx?: LogContext): void {
    this.log('trace', LOG_LEVELS.trace, msg, ctx);
  }

  debug(msg: string, ctx?: LogContext): void {
    this.log('debug', LOG_LEVELS.debug, msg, ctx);
  }

  info(msg: string, ctx?: LogContext): void {
    this.log('info', LOG_LEVELS.info, msg, ctx);
  }

  warn(msg: string, ctx?: LogContext): void {
    this.log('warn', LOG_LEVELS.warn, msg, ctx);
  }

  error(msg: string, err?: Error | LogContext, ctx?: LogContext): void {
    this.log('error', LOG_LEVELS.error, msg, err, ctx);
  }

  fatal(msg: string, err?: Error | LogContext, ctx?: LogContext): void {
    this.log('fatal', LOG_LEVELS.fatal, msg, err, ctx);
  }

  child(bindings: LogContext): Logger {
    return new LoggerImpl(
      { level: this.getLevelName(), format: this.format, destination: this.destination },
      { ...this.bindings, ...bindings }
    );
  }

  private getLevelName(): 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' {
    for (const [name, num] of Object.entries(LOG_LEVELS)) {
      if (num === this.level) return name as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    }
    return 'info';
  }
}

/**
 * Creates a logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new LoggerImpl(options);
}

// ============================================================================
// Metrics
// ============================================================================

export interface MetricValue {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface Counter {
  inc: (value?: number, labels?: Record<string, string>) => void;
  get: () => number;
}

export interface Histogram {
  observe: (value: number, labels?: Record<string, string>) => void;
  get: () => { count: number; sum: number; buckets: Record<number, number> };
}

class CounterImpl implements Counter {
  private count = 0;
  private labelCounts = new Map<string, number>();

  inc(value = 1, labels?: Record<string, string>): void {
    this.count += value;
    if (labels) {
      const key = JSON.stringify(labels);
      this.labelCounts.set(key, (this.labelCounts.get(key) ?? 0) + value);
    }
  }

  get(): number {
    return this.count;
  }
}

class HistogramImpl implements Histogram {
  private buckets: number[];
  private bucketCounts: Map<number, number>;
  private sum = 0;
  private count = 0;

  constructor(buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.buckets = buckets;
    this.bucketCounts = new Map(buckets.map(b => [b, 0]));
  }

  observe(value: number): void {
    this.count++;
    this.sum += value;

    for (const bucket of this.buckets) {
      if (value <= bucket) {
        this.bucketCounts.set(bucket, (this.bucketCounts.get(bucket) ?? 0) + 1);
      }
    }
  }

  get(): { count: number; sum: number; buckets: Record<number, number> } {
    const buckets: Record<number, number> = {};
    for (const [bucket, count] of this.bucketCounts) {
      buckets[bucket] = count;
    }
    return { count: this.count, sum: this.sum, buckets };
  }
}

const metrics = new Map<string, Counter | Histogram>();

export const Metrics = {
  counter: (name: string): Counter => {
    if (!metrics.has(name)) {
      metrics.set(name, new CounterImpl());
    }
    return metrics.get(name) as Counter;
  },

  histogram: (name: string, buckets?: number[]): Histogram => {
    if (!metrics.has(name)) {
      metrics.set(name, new HistogramImpl(buckets));
    }
    return metrics.get(name) as Histogram;
  },

  clear: (): void => {
    metrics.clear();
  },

  getAll: (): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const [name, metric] of metrics) {
      if (metric instanceof CounterImpl) {
        result[name] = metric.get();
      }
    }
    return result;
  },
};

// ============================================================================
// Health Checks
// ============================================================================

export interface HealthCheck {
  name: string;
  check: () => Promise<{ status: 'up' | 'down'; details?: Record<string, unknown> }> | { status: 'up' | 'down'; details?: Record<string, unknown> };
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  checks: Record<string, { status: 'up' | 'down'; details?: Record<string, unknown> }>;
  timestamp: string;
}

const healthChecks = new Map<string, HealthCheck>();

export const Health = {
  register: (check: HealthCheck): void => {
    healthChecks.set(check.name, check);
  },

  unregister: (name: string): void => {
    healthChecks.delete(name);
  },

  check: async (): Promise<HealthCheckResult> => {
    const checks: Record<string, { status: 'up' | 'down'; details?: Record<string, unknown> }> = {};
    let allUp = true;

    for (const [name, check] of healthChecks) {
      try {
        const result = await check.check();
        checks[name] = result;
        if (result.status === 'down') {
          allUp = false;
        }
      } catch (error) {
        checks[name] = {
          status: 'down',
          details: { error: error instanceof Error ? error.message : String(error) },
        };
        allUp = false;
      }
    }

    return {
      status: allUp ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date().toISOString(),
    };
  },
};

// Default health check
Health.register({
  name: 'app',
  check: () => ({ status: 'up' }),
});

// ============================================================================
// Tracing
// ============================================================================

export interface Span {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
}

class TracerImpl {
  private spans: Span[] = [];

  startSpan(name: string, attributes?: Record<string, unknown>): Span {
    const span: Span = {
      id: crypto.randomUUID(),
      name,
      startTime: Date.now(),
      attributes: attributes ?? {},
      status: 'ok',
    };
    this.spans.push(span);
    return span;
  }

  endSpan(span: Span, status: 'ok' | 'error' = 'ok'): void {
    span.endTime = Date.now();
    span.status = status;
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans = [];
  }
}

export const tracer = new TracerImpl();

// ============================================================================
// Default Export
// ============================================================================

export const observability = {
  createLogger,
  logger: createLogger(),
  metrics: Metrics,
  health: Health,
  tracer,
};

export default observability;
