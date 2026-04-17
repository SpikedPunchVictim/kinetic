import { describe, it, expect } from 'vitest';
import { createApp } from '@klusterio/kinetic-core';
import { CorsAddon } from '../src/index.js';

async function makeApp(config?: Parameters<typeof CorsAddon.plugin>[0]) {
  const app = await createApp({ createAppContext: async () => ({}) });
  await app.register(CorsAddon.plugin(config));
  app.get('/test', async () => ({ ok: true }));
  return app;
}

describe('CorsAddon', () => {
  describe('plugin()', () => {
    it('returns a function', () => {
      expect(typeof CorsAddon.plugin()).toBe('function');
    });

    it('adds Access-Control-Allow-Origin: * by default', async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('reflects specific origin when configured', async () => {
      const app = await makeApp({ origin: 'https://app.example.com' });
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://app.example.com' },
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    });

    it('returns 204 on preflight OPTIONS request', async () => {
      const app = await makeApp({ methods: ['GET', 'POST'] });
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/test',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
        },
      });
      expect(res.statusCode).toBe(204);
    });

    it('sets credentials header when credentials: true', async () => {
      const app = await makeApp({
        origin: 'https://app.example.com',
        credentials: true,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://app.example.com' },
      });
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('exposes custom headers when exposedHeaders is set', async () => {
      const app = await makeApp({ exposedHeaders: ['x-request-id'] });
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { origin: 'https://example.com' },
      });
      expect(res.headers['access-control-expose-headers']).toContain('x-request-id');
    });
  });
});
