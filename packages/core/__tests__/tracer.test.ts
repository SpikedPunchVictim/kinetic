/**
 * InMemoryTracer Tests
 * Tests actual features: span creation, log rotation, attribute tracking
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTracer } from '../src/tracer.js';

describe('InMemoryTracer', () => {
  let tracer: InMemoryTracer;

  beforeEach(() => {
    tracer = new InMemoryTracer();
  });

  describe('span creation', () => {
    it('should create span with unique id', () => {
      const span1 = tracer.startSpan('test');
      const span2 = tracer.startSpan('test');

      expect(span1.id).toBeDefined();
      expect(span2.id).toBeDefined();
      expect(span1.id).not.toBe(span2.id);
    });

    it('should store span name', () => {
      const span = tracer.startSpan('db.query');
      expect(span.name).toBe('db.query');
    });

    it('should set start time on creation', () => {
      const before = Date.now();
      const span = tracer.startSpan('test');
      const after = Date.now();

      expect(span.startTime).toBeGreaterThanOrEqual(before);
      expect(span.startTime).toBeLessThanOrEqual(after);
    });

    it('should support parent span', () => {
      const parent = tracer.startSpan('parent');
      const child = tracer.startSpan('child', { parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
    });
  });

  describe('span attributes', () => {
    it('should set attributes on span', () => {
      const span = tracer.startSpan('test');
      span.setAttribute('userId', '123');

      const logs = tracer.getLogs();
      expect(logs[0].attributes.userId).toBe('123');
    });

    it('should support multiple attributes', () => {
      const span = tracer.startSpan('request');
      span.setAttribute('method', 'GET');
      span.setAttribute('path', '/users');
      span.setAttribute('duration', 42);

      const logs = tracer.getLogs();
      expect(logs[0].attributes.method).toBe('GET');
      expect(logs[0].attributes.path).toBe('/users');
      expect(logs[0].attributes.duration).toBe(42);
    });
  });

  describe('span lifecycle', () => {
    it('should set end time when ended', () => {
      const span = tracer.startSpan('test');
      span.end();

      const logs = tracer.getLogs();
      expect(logs[0].endTime).toBeDefined();
    });

    it('should calculate duration', () => {
      const span = tracer.startSpan('test');
      span.end();

      const logs = tracer.getLogs();
      const duration = logs[0].endTime! - logs[0].startTime;
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('log rotation', () => {
    it('should store logs', () => {
      tracer.startSpan('span1');
      tracer.startSpan('span2');

      expect(tracer.getLogs()).toHaveLength(2);
    });

    it('should get recent logs', () => {
      for (let i = 0; i < 10; i++) {
        tracer.startSpan(`span-${i}`);
      }

      const recent = tracer.getRecent(3);
      expect(recent).toHaveLength(3);
      expect(recent[2].name).toBe('span-9');
    });

    it('should return empty array for no logs', () => {
      expect(tracer.getLogs()).toEqual([]);
    });

    it('should clear logs', () => {
      tracer.startSpan('test');
      tracer.clear();

      expect(tracer.getLogs()).toHaveLength(0);
    });
  });

  describe('retrieving spans', () => {
    it('should get span by id', () => {
      const span = tracer.startSpan('test');
      const found = tracer.getById(span.id);

      expect(found).toBeDefined();
      expect(found?.name).toBe('test');
    });

    it('should return undefined for unknown id', () => {
      const found = tracer.getById('non-existent');
      expect(found).toBeUndefined();
    });

    it('should get child spans', () => {
      const parent = tracer.startSpan('parent');
      tracer.startSpan('child1', { parentId: parent.id });
      tracer.startSpan('child2', { parentId: parent.id });
      tracer.startSpan('sibling', { parentId: 'other' });

      const children = tracer.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.every(c => c.parentId === parent.id)).toBe(true);
    });
  });

  describe('log rotation', () => {
    it('should rotate logs when exceeding maxLines', async () => {
      // Create 2501 entries (max is 2500)
      for (let i = 0; i < 2501; i++) {
        tracer.startSpan(`span-${i}`);
      }

      const logs = tracer.getLogs();
      expect(logs.length).toBeLessThanOrEqual(2500);

      // Oldest entries should be removed
      const firstEntry = logs[0];
      // First entry should not be span-0 (it was rotated out)
      expect(firstEntry.name).not.toBe('span-0');
    });

    it('should maintain most recent entries after rotation', () => {
      // Fill to capacity
      for (let i = 0; i < 2500; i++) {
        tracer.startSpan(`span-${i}`);
      }

      // Add more entries
      tracer.startSpan('span-2500');
      tracer.startSpan('span-2501');

      const logs = tracer.getLogs();
      const names = logs.map(l => l.name);

      expect(names).toContain('span-2500');
      expect(names).toContain('span-2501');
    });
  });

  describe('edge cases', () => {
    it('should handle empty attribute names', () => {
      const span = tracer.startSpan('test');
      span.setAttribute('', 'value');

      const logs = tracer.getLogs();
      expect(logs[0].attributes['']).toBe('value');
    });

    it('should handle attribute value overwrite', () => {
      const span = tracer.startSpan('test');
      span.setAttribute('key', 'first');
      span.setAttribute('key', 'second');

      const logs = tracer.getLogs();
      expect(logs[0].attributes.key).toBe('second');
    });

    it('should support complex attribute values', () => {
      const span = tracer.startSpan('test');
      span.setAttribute('data', { nested: { value: 123 } });
      span.setAttribute('array', [1, 2, 3]);

      const logs = tracer.getLogs();
      expect(logs[0].attributes.data).toEqual({ nested: { value: 123 } });
      expect(logs[0].attributes.array).toEqual([1, 2, 3]);
    });

    it('should handle empty tracer', () => {
      tracer.clear();
      expect(tracer.getLogs()).toHaveLength(0);
      expect(tracer.getRecent(100)).toHaveLength(0);
    });
  });
});
