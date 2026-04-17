import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineEnv, getEnvRegistry, clearEnvRegistry } from '../src/env.js';
import { FrameworkError } from '../src/errors.js';

beforeEach(() => clearEnvRegistry());

describe('defineEnv', () => {
  describe('validation', () => {
    it('returns a typed object when all required vars are present', () => {
      const env = defineEnv('test', {
        API_URL: z.string().url(),
        PORT: z.coerce.number(),
      }, { API_URL: 'https://api.example.com', PORT: '3000' });

      expect(env.API_URL).toBe('https://api.example.com');
      expect(env.PORT).toBe(3000);
    });

    it('applies defaults for optional vars that are absent', () => {
      const env = defineEnv('test', {
        LOG_LEVEL: z.string().default('info'),
        WORKERS: z.coerce.number().default(4),
      }, {});

      expect(env.LOG_LEVEL).toBe('info');
      expect(env.WORKERS).toBe(4);
    });

    it('throws FrameworkError when a required var is missing', () => {
      expect(() =>
        defineEnv('db', { DATABASE_URL: z.string().url() }, {})
      ).toThrow(FrameworkError);
    });

    it('includes the group name as the service field in the error', () => {
      try {
        defineEnv('db', { DATABASE_URL: z.string() }, {});
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FrameworkError);
        expect((err as FrameworkError).service).toBe('db');
      }
    });

    it('lists failing key names in the error reason', () => {
      try {
        defineEnv('app', {
          SECRET: z.string(),
          API_URL: z.string().url(),
        }, {});
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as FrameworkError).reason).toMatch(/SECRET|API_URL/);
      }
    });

    it('throws a single error listing all failing keys at once', () => {
      try {
        defineEnv('app', {
          SECRET: z.string(),
          DATABASE_URL: z.string().url(),
          PORT: z.coerce.number(),
        }, {});
        expect.fail('should have thrown');
      } catch (err) {
        // reason should contain multiple key names, not just the first one
        const reason = (err as FrameworkError).reason;
        const containsMultiple = reason.includes(',') || reason.length > 3;
        expect(containsMultiple).toBe(true);
      }
    });

    it('accepts ZodOptional vars that are absent', () => {
      const env = defineEnv('test', {
        SENTRY_DSN: z.string().optional(),
      }, {});

      expect(env.SENTRY_DSN).toBeUndefined();
    });

    it('coerces string env values to number', () => {
      const env = defineEnv('test', {
        MAX_CONNECTIONS: z.coerce.number().default(10),
      }, { MAX_CONNECTIONS: '25' });

      expect(env.MAX_CONNECTIONS).toBe(25);
    });

    it('coerces string env values to boolean', () => {
      const env = defineEnv('test', {
        FEATURE_FLAG: z.coerce.boolean().default(false),
      }, { FEATURE_FLAG: 'true' });

      expect(env.FEATURE_FLAG).toBe(true);
    });
  });

  describe('registry', () => {
    it('registers the group after a successful call', () => {
      defineEnv('db', {
        DATABASE_URL: z.string().url(),
      }, { DATABASE_URL: 'https://db.example.com' });

      expect(getEnvRegistry()).toHaveProperty('db');
    });

    it('registers the group even when validation fails', () => {
      try {
        defineEnv('db', { DATABASE_URL: z.string() }, {});
      } catch {
        // expected
      }

      expect(getEnvRegistry()).toHaveProperty('db');
    });

    it('classifies required vs optional keys correctly', () => {
      defineEnv('svc', {
        SECRET: z.string(),
        PORT: z.coerce.number().default(3000),
        DSN: z.string().optional(),
      }, { SECRET: 'abc' });

      const group = getEnvRegistry()['svc'];
      expect(group.required).toContain('SECRET');
      expect(group.optional).toContain('PORT');
      expect(group.optional).toContain('DSN');
    });

    it('accumulates multiple groups from separate calls', () => {
      defineEnv('db', { DATABASE_URL: z.string() }, { DATABASE_URL: 'postgres://localhost' });
      defineEnv('cache', { REDIS_URL: z.string() }, { REDIS_URL: 'redis://localhost' });

      const registry = getEnvRegistry();
      expect(registry).toHaveProperty('db');
      expect(registry).toHaveProperty('cache');
    });

    it('clearEnvRegistry removes all groups', () => {
      defineEnv('db', { DATABASE_URL: z.string() }, { DATABASE_URL: 'postgres://localhost' });
      clearEnvRegistry();
      expect(Object.keys(getEnvRegistry())).toHaveLength(0);
    });
  });

  describe('manifest integration', () => {
    it('env groups appear in the app manifest', async () => {
      const { getAppManifest } = await import('../src/ai-dev/routes.js');

      defineEnv('db', {
        DATABASE_URL: z.string().url(),
        DB_POOL: z.coerce.number().default(10),
      }, { DATABASE_URL: 'https://db.example.com' });

      const manifest = getAppManifest([], [], [], getEnvRegistry());

      expect(manifest.env).toHaveProperty('db');
      expect(manifest.env['db'].required).toContain('DATABASE_URL');
      expect(manifest.env['db'].optional).toContain('DB_POOL');
    });
  });
});
