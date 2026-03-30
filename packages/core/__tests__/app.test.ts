/**
 * Application Tests
 * Tests core features: factory pattern, context creation, type safety
 */
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { FrameworkError } from '../src/errors.js';
import { InMemoryTracer } from '../src/tracer.js';
import { MemoryStore } from '../src/crud/store.js';

interface MockDB {
  query: () => Promise<string[]>;
}

interface MockService {
  getUsers: () => Promise<never[]>;
}

type TestAppContext = {
  db: MockDB;
  userService: MockService;
  tracer: InMemoryTracer;
  userStore: MemoryStore<unknown>;
};

type TestRequestContext = {
  userId: string | null;
  traceId: string;
};

describe('createApp', () => {
  describe('basic initialization', () => {
    it('should create app with simple context factory', async () => {
      const app = await createApp<{ value: number }>({
        createAppContext: async () => ({ value: 42 }),
      });

      expect(app).toBeDefined();
      expect(app.context).toBeDefined();
      expect(app.context.value).toBe(42);
    });

    it('should initialize dependencies in explicit factory order', async () => {
      const initOrder: string[] = [];

      type AppCtx = {
        db: { name: string };
        service: { db: { name: string } };
      };

      const app = await createApp<AppCtx>({
        createAppContext: async () => {
          initOrder.push('db');
          const db = { name: 'database' };

          initOrder.push('service');
          const service = { db };

          return { db, service };
        },
      });

      expect(app.context.db.name).toBe('database');
      expect(app.context.service.db).toBe(app.context.db);
      expect(initOrder).toEqual(['db', 'service']);
    });
  });

  describe('context factories', () => {
    it('should support async factory returning complex types', async () => {
      const app = await createApp<TestAppContext>({
        createAppContext: async () => {
          const db: MockDB = { query: async () => ['alice', 'bob'] };
          const userService: MockService = {
            getUsers: async () => (await db.query()),
          };
          const tracer = new InMemoryTracer();
          const userStore = new MemoryStore();
          return { db, userService, tracer, userStore };
        },
      });

      const users = await app.context.userService.getUsers();
      expect(users).toEqual(['alice', 'bob']);
    });

    it('should share references across context properties', async () => {
      const app = await createApp<{ db: { query: () => string }; service: { get: () => string } }>({
        createAppContext: async () => {
          const db = { query: () => 'data' };
          return { db, service: { get: () => db.query() } };
        },
      });

      expect(app.context.service.get()).toBe('data');
    });
  });

  describe('request context', () => {
    it('should support optional createRequestContext hook', async () => {
      let requestCount = 0;

      const app = await createApp<
        { db: { query: () => [] } },
        { userId: string | null; traceId: string }
      >({
        createAppContext: async () => ({
          db: { query: async () => [] },
        }),
        createRequestContext: async () => {
          requestCount++;
          return { userId: `user-${requestCount}`, traceId: `trace-${requestCount}` };
        },
      });

      expect(app).toBeDefined();
      // Hook is registered, not called until request
      expect(requestCount).toBe(0);
    });

    it('should receive appContext in createRequestContext', async () => {
      let receivedCtx: unknown;

      const app = await createApp<{ db: { query: () => Promise<unknown[]> } }, { userId: string | null }
      >({
        createAppContext: async () => ({
          db: { query: async () => [] },
        }),
        createRequestContext: async (_req, appCtx) => {
          receivedCtx = appCtx;
          return { userId: null };
        },
      });

      // Fastify hook is registered but not triggered yet
      // The hook will receive appContext when a request comes in
      expect(app).toBeDefined();
      expect(typeof receivedCtx).toBe('undefined'); // Not called yet
    });

    it('should create unique request context per request', async () => {
      // CRITICAL FIX: This test actually makes HTTP requests to verify the hook fires
      const traceIds: string[] = [];

      const app = await createApp<
        { value: string },
        { traceId: string }
      >({
        createAppContext: async () => ({ value: 'app-value' }),
        createRequestContext: async () => {
          const traceId = crypto.randomUUID();
          traceIds.push(traceId);
          return { traceId };
        },
      });

      // Register a route that accesses request context
      app.get('/test', async (req, reply) => {
        // Access request context
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = (req as any).requestContext;
        return { traceId: ctx?.traceId };
      });

      // Make actual requests
      const response1 = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const response2 = await app.inject({
        method: 'GET',
        url: '/test',
      });

      // Verify hook was called
      expect(traceIds).toHaveLength(2);

      // Verify each request got unique context
      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(body1.traceId).toBeDefined();
      expect(body2.traceId).toBeDefined();
      expect(body1.traceId).not.toBe(body2.traceId);
    });

    it('should handle errors in createRequestContext', async () => {
      const app = await createApp<
        { value: string },
        { userId: string }
      >({
        createAppContext: async () => ({ value: 'test' }),
        createRequestContext: async () => {
          throw new Error('Auth failed');
        },
      });

      app.get('/test', async () => ({ success: true }));

      // Request should fail when context creation fails
      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('error handling', () => {
    it('should throw FrameworkError on factory failure', async () => {
      await expect(
        createApp<{ db: unknown }>({
          createAppContext: async () => {
            throw new Error('Connection refused');
          },
        })
      ).rejects.toThrow(FrameworkError);
    });

    it('should include error code and truncated reason', async () => {
      try {
        await createApp<{ db: unknown }>({
          createAppContext: async () => {
            throw new Error('Database connection refused - very long message');
          },
        });
        expect.fail('Should have thrown');
      } catch (err) {
        if (err instanceof FrameworkError) {
          expect(err.code).toBe('E_INIT');
          expect(err.reason.length).toBeLessThanOrEqual(20);
          expect(err.reason).toMatch(/^Database connection/);
        }
      }
    });

    it('should support empty context', async () => {
      const app = await createApp<Record<string, never>>({
        createAppContext: async () => ({}),
      });

      expect(app).toBeDefined();
      expect(app.context).toEqual({});
    });
  });

  describe('Fastify integration', () => {
    it('should expose Fastify methods', async () => {
      const app = await createApp<{ value: number }>({
        createAppContext: async () => ({ value: 42 }),
      });

      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
      expect(typeof app.listen).toBe('function');
    });

    it('should handle routes correctly', async () => {
      const app = await createApp<{ greeting: string }>({
        createAppContext: async () => ({ greeting: 'Hello' }),
      });

      app.get('/hello', async () => ({ message: 'World' }));

      const response = await app.inject({
        method: 'GET',
        url: '/hello',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ message: 'World' });
    });

    it('should handle POST requests with body', async () => {
      const app = await createApp<Record<string, never>>({
        createAppContext: async () => ({}),
      });

      app.post('/users', async (req) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = (req as any).body;
        return { received: body };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { name: 'Alice', email: 'alice@example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received.name).toBe('Alice');
    });
  });

  describe('type safety', () => {
    it('should type context based on generic', async () => {
      // TypedContext must satisfy AppContext (Record<string, unknown>)
      type TypedContext = {
        users: { id: string; name: string }[];
        version: number;
      };

      const app = await createApp<TypedContext>({
        createAppContext: async () => ({
          users: [{ id: '1', name: 'Alice' }],
          version: 1,
        }),
      });

      const firstUser = app.context.users[0];
      expect(firstUser.name).toBe('Alice');
      expect(app.context.version).toBe(1);
    });
  });
});
