import { describe, it, expect } from 'vitest';
import { JwtAddon, JWTService } from '../src/index.js';

describe('JWT Addon', () => {
  describe('JwtAddon factory', () => {
    it('should create JWT service with create()', async () => {
      const service = await JwtAddon.create({ secret: 'test-secret-test-secret-test-secret-test-secret-secret-test-secret' });
      expect(service).toBeDefined();
      expect(typeof service.sign).toBe('function');
      expect(typeof service.verify).toBe('function');
      expect(typeof service.decode).toBe('function');
    });
  });

  describe('JWTService', () => {
    it('should sign and verify tokens', async () => {
      const service = await JwtAddon.create({
        secret: 'test-secret-test-secret-test-secret-test-secret',
        expiresIn: '1h',
      });

      const token = service.sign({ sub: 'user-123' });

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      // Verify the token
      const claims = service.verify(token);
      expect(claims.sub).toBe('user-123');
    });

    it('should decode tokens without verification', async () => {
      const service = await JwtAddon.create({
        secret: 'test-secret-test-secret-test-secret-test-secret',
      });

      const token = service.sign({ sub: 'user-123', custom: 'data' });
      const decoded = service.decode(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe('user-123');
    });

    it('should fail verification with wrong secret', async () => {
      const service1 = await JwtAddon.create({
        secret: 'test-secret-test-secret-test-secret-test-secret1',
      });
      const service2 = await JwtAddon.create({
        secret: 'test-secret-test-secret-test-secret-test-secret2',
      });

      const token = service1.sign({ sub: 'user-123' });

      expect(() => service2.verify(token)).toThrow();
    });
  });

  describe('JwtAddon middleware', () => {
    it('should create middleware function', async () => {
      const middleware = JwtAddon.middleware({
        secret: 'test-secret-test-secret-test-secret-test-secret',
      });

      expect(typeof middleware).toBe('function');
    });
  });

  describe('createAuthHook', () => {
    it('should fail with no authorization header', async () => {
      const authHook = JwtAddon.createAuthHook({
        secret: 'test-secret-test-secret-test-secret-test-secret',
      });

      const result = await authHook({ headers: {} });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No authorization token');
    });

    it('should fail with invalid token', async () => {
      const authHook = JwtAddon.createAuthHook({
        secret: 'test-secret-test-secret-test-secret-test-secret',
      });

      const result = await authHook({
        headers: { authorization: 'Bearer invalid-token' },
      });

      expect(result.success).toBe(false);
    });

    it('should succeed with valid token', async () => {
      const service = await JwtAddon.create({
        secret: 'test-secret-test-secret-test-secret-test-secret',
      });
      const token = service.sign({ sub: 'user-123' });

      const authHook = JwtAddon.createAuthHook({
        secret: 'test-secret-test-secret-test-secret-test-secret',
      });

      const result = await authHook({
        headers: { authorization: `Bearer ${token}` },
      });

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('user-123');
    });
  });
});
