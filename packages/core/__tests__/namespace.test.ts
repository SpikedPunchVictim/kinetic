import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { defineNamespace } from '../src/namespace.js';

type MainAppCtx = { db: { query: () => string } };

async function buildApp() {
  return createApp<MainAppCtx>({
    createAppContext: async () => ({ db: { query: () => 'result' } }),
    gracefulShutdown: false,
  });
}

describe('defineNamespace', () => {
  it('merges app and request context onto req[name]', async () => {
    const app = await buildApp();

    const withAuth = await defineNamespace(app, 'auth', {
      createAppContext: async (appCtx) => ({ db: appCtx.db }),
      createRequestContext: async (_req, _nsAppCtx) => ({ user: { id: '42' } }),
    });

    app.get('/me', withAuth(async (req, reply) => {
      reply.send({ user: req.auth.user, hasDb: typeof req.auth.db === 'object' });
    }));

    const res = await app.inject({ method: 'GET', url: '/me' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.user).toEqual({ id: '42' });
    expect(body.hasDb).toBe(true);
  });

  it('calls createRequestContext on every request with a fresh result', async () => {
    const app = await buildApp();
    let callCount = 0;

    const withTrace = await defineNamespace(app, 'trace', {
      createAppContext: async () => ({}),
      createRequestContext: async () => {
        callCount++;
        return { id: callCount };
      },
    });

    app.get('/ping', withTrace(async (req, reply) => {
      reply.send({ id: req.trace.id });
    }));

    const r1 = await app.inject({ method: 'GET', url: '/ping' });
    const r2 = await app.inject({ method: 'GET', url: '/ping' });

    expect(r1.json().id).toBe(1);
    expect(r2.json().id).toBe(2);
  });

  it('calls createAppContext once regardless of request count', async () => {
    const app = await buildApp();
    let initCount = 0;

    await defineNamespace(app, 'svc', {
      createAppContext: async () => {
        initCount++;
        return { token: 'shared' };
      },
      createRequestContext: async () => ({}),
    });

    app.get('/a', async (_req, reply) => reply.send('ok'));

    await app.inject({ method: 'GET', url: '/a' });
    await app.inject({ method: 'GET', url: '/a' });

    expect(initCount).toBe(1);
  });

  it('throws if registered after the server is listening', async () => {
    const app = await buildApp();
    await app.listen({ port: 0 });

    await expect(
      defineNamespace(app, 'late', {
        createAppContext: async () => ({}),
        createRequestContext: async () => ({}),
      }),
    ).rejects.toThrow("defineNamespace('late') called after the server is already listening");

    await app.close();
  });

  it('receives the main appContext in createAppContext', async () => {
    const app = await buildApp();
    let receivedCtx: MainAppCtx | undefined;

    await defineNamespace(app, 'check', {
      createAppContext: async (appCtx) => {
        receivedCtx = appCtx;
        return {};
      },
      createRequestContext: async () => ({}),
    });

    expect(receivedCtx).toBe(app.context);
  });
});
