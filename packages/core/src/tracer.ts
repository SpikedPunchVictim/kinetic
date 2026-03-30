/**
 * Built-in tracing provider
 * ADR-002: In-memory tracer with log rotation for dev, pluggable for prod
 */

import type { Span, TracerProvider } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface TraceEntry {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  parentId?: string;
  attributes: Record<string, unknown>;
}

export interface SpanImpl extends Span {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  parentId?: string;
}

// ============================================================================
// In-Memory Tracer
// ============================================================================

export class InMemoryTracer implements TracerProvider {
  private logs: TraceEntry[] = [];
  private maxLines = 2500;

  startSpan(name: string, options?: { parentId?: string }): SpanImpl {
    const id = crypto.randomUUID();
    const entry: TraceEntry = {
      id,
      name,
      startTime: Date.now(),
      parentId: options?.parentId,
      attributes: {},
    };
    this.logs.push(entry);
    this.rotateIfNeeded();

    return {
      id,
      name: entry.name,
      startTime: entry.startTime,
      parentId: entry.parentId,
      setAttribute: (k: string, v: unknown) => {
        entry.attributes[k] = v;
      },
      end: () => {
        entry.endTime = Date.now();
      },
    };
  }

  /**
   * Get all trace entries
   */
  getLogs(): TraceEntry[] {
    return [...this.logs];
  }

  /**
   * Get recent entries (last N)
   */
  getRecent(limit = 100): TraceEntry[] {
    return this.logs.slice(-limit);
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs.length = 0;
  }

  /**
   * Get trace entry by ID
   */
  getById(id: string): TraceEntry | undefined {
    return this.logs.find(e => e.id === id);
  }

  /**
   * Get child spans for a parent
   */
  getChildren(parentId: string): TraceEntry[] {
    return this.logs.filter(e => e.parentId === parentId);
  }

  private rotateIfNeeded(): void {
    if (this.logs.length > this.maxLines) {
      this.logs = this.logs.slice(-this.maxLines);
    }
  }
}

// ============================================================================
// Fastify Plugin
// ============================================================================

interface FastifyInstance {
  get: (path: string, handler: () => Promise<unknown> | unknown) => void;
  log?: { info: (msg: string) => void };
}

/**
 * Register debug trace endpoint
 * GET /__debug/traces - Returns recent trace entries
 */
export function registerTraceEndpoint(
  fastify: FastifyInstance,
  tracer: InMemoryTracer
): void {
  fastify.get('/__debug/traces', async () => {
    return {
      data: tracer.getRecent(100),
      count: tracer.getRecent(100).length,
    };
  });

  fastify.get('/__debug/traces/all', async () => {
    return {
      data: tracer.getLogs(),
      count: tracer.getLogs().length,
    };
  });

  if (fastify.log) {
    fastify.log.info('Trace endpoint registered at /__debug/traces');
  }
}
