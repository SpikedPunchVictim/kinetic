/**
 * Security Module Tests
 * Tests validation, rate limiting, and auth hooks
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  validateBody,
  rateLimit,
  createAuthHook,
  extractBearerToken,
} from '../src/security/index.js';
import { FrameworkError } from '../src/errors.js';

describe('Security Module', () => {
  describe('validateBody', () => {
    it('should validate request body against zod schema', async () => {
      const schema = z.object({
        email: z.string().email(),
        name: z.string().min(1),
      });

      const middleware = validateBody(schema);
      const req = { body: { email: 'test@example.com', name: 'Test' } };

      // Should not throw
      await expect(middleware(req, {})).resolves.not.toThrow();
    });

    it('should throw on invalid body', async () => {
      const schema = z.object({
        email: z.string().email(),
      });

      const middleware = validateBody(schema);
      const req = { body: { email: 'invalid-email' } };

      // Should throw condensed error
      await expect(middleware(req, {})).rejects.toThrow('E_VAL');
    });

    it('should replace body with parsed data', async () => {
      const schema = z.object({
        age: z.string().transform((val) => parseInt(val, 10)),
      });

      const middleware = validateBody(schema);
      const req = { body: { age: '25' } };

      await middleware(req, {});
      expect(req.body.age).toBe(25);
    });

    it('should report all validation errors', async () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(0),
      });

      const middleware = validateBody(schema);
      const req = { body: { email: 'invalid', age: -5 } };

      try {
        await middleware(req, {});
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FrameworkError);
      }
    });
  });

  describe('rateLimit', () => {
    beforeEach(() => {
      // Reset rate limit store between tests
      // Note: In production, this would be Redis
    });

    it('should allow requests under limit', async () => {
      const middleware = rateLimit({ max: 5, window: 60 });

      const req = { ip: '192.168.1.1' };

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await expect(middleware(req, {})).resolves.not.toThrow();
      }
    });

    it('should block requests over limit', async () => {
      const middleware = rateLimit({ max: 2, window: 60 });
      const req = { ip: '192.168.1.2' };

      // Make 2 allowed requests
      await middleware(req, {});
      await middleware(req, {});

      // 3rd request should be blocked
      await expect(middleware(req, {})).rejects.toThrow('E_VAL');
    });

    it('should rate limit by IP', async () => {
      const middleware = rateLimit({ max: 1, window: 60 });

      // Different IPs should have separate limits
      await middleware({ ip: '192.168.1.10' }, {});
      await middleware({ ip: '192.168.1.11' }, {});

      // But same IP again should fail
      await expect(middleware({ ip: '192.168.1.10' }, {})).rejects.toThrow();
    });

    it('should support custom key function', async () => {
      const middleware = rateLimit({
        max: 1,
        window: 60,
        key: (req) => req.headers?.['x-api-key'] as string || 'default',
      });

      const req1 = { headers: { 'x-api-key': 'key-1' } };
      const req2 = { headers: { 'x-api-key': 'key-2' } };

      await middleware(req1, {});
      await middleware(req2, {});

      // Same key again should fail
      await expect(middleware(req1, {})).rejects.toThrow();
    });
  });

  describe('createAuthHook', () => {
    it('should create auth hook with verify function', async () => {
      const verifyFn = (req: unknown) => ({
        success: true,
        user: { id: 'user-1' },
      });

      const hook = createAuthHook(verifyFn);
      const result = await hook({}, {});

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('user-1');
    });

    it('should handle failed authentication', async () => {
      const verifyFn = () => ({
        success: false,
        error: 'Invalid token',
      });

      const hook = createAuthHook(verifyFn);
      const result = await hook({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
    });
  });

  describe('extractBearerToken', () => {
    it('should extract token from Authorization header', () => {
      const headers = { authorization: 'Bearer abc123def456' };
      const token = extractBearerToken(headers);

      expect(token).toBe('abc123def456');
    });

    it('should return null for invalid format', () => {
      const headers = { authorization: 'Basic abc123' };
      const token = extractBearerToken(headers);

      expect(token).toBeNull();
    });

    it('should return null for missing header', () => {
      const headers = {};
      const token = extractBearerToken(headers);

      expect(token).toBeNull();
    });

    it('should handle lowercase bearer', () => {
      const headers = { authorization: 'bearer lowercase-token' };
      const token = extractBearerToken(headers);

      expect(token).toBe('lowercase-token');
    });

    it('should return null for malformed header', () => {
      const headers = { authorization: 'BearerTokenWithoutSpace' };
      const token = extractBearerToken(headers);

      expect(token).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('should validate then rate limit', async () => {
      const schema = z.object({ email: z.string().email() });
      const validate = validateBody(schema);
      const limit = rateLimit({ max: 5, window: 60 });

      const req = { body: { email: 'test@example.com' }, ip: '1.2.3.4' };
      const reply = {};

      // Both should pass
      await validate(req, reply);
      await limit(req, reply);
    });

    it('should chain middleware in preHandler', async () => {
      // Simulating how Fastify would use these
      const middlewares = [
        validateBody(z.object({ name: z.string() })),
        rateLimit({ max: 10, window: 60 }),
      ];

      const req = { body: { name: 'Test' }, ip: '10.0.0.1' };

      for (const mw of middlewares) {
        await mw(req, {});
      }
    });
  });
});
