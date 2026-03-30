import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  getConfigValue,
  mergeConfig,
  AppConfigSchema,
  DatabaseConfigSchema,
  ServerConfigSchema,
} from '../src/config/index.js';
import { FrameworkError } from '../src/errors.js';

describe('Config Module', () => {
  describe('loadConfig', () => {
    it('should load configuration with defaults', () => {
      const config = loadConfig({ env: {} });

      expect(config.name).toBe('app');
      expect(config.version).toBe('1.0.0');
      expect(config.server.port).toBe(3000);
      expect(config.server.env).toBe('development');
    });

    it('should load configuration from environment variables', () => {
      const config = loadConfig({
        env: {
          PORT: '8080',
          APP_NAME: 'MyApp',
          DATABASE_HOST: 'db.example.com',
          LOG_LEVEL: 'debug',
        },
      });

      expect(config.server.port).toBe(8080);
      expect(config.name).toBe('MyApp');
      expect(config.database.host).toBe('db.example.com');
      expect(config.logging.level).toBe('debug');
    });

    it('should parse boolean environment variables', () => {
      const config = loadConfig({
        env: {
          DATABASE_SSL: 'true',
        },
      });

      expect(config.database.ssl).toBe(true);
    });

    it('should parse number environment variables', () => {
      const config = loadConfig({
        env: {
          DATABASE_PORT: '5433',
          RATE_LIMIT_MAX: '500',
        },
      });

      expect(config.database.port).toBe(5433);
      expect(config.security.rateLimitMax).toBe(500);
    });

    it('should throw FrameworkError for invalid PORT value', () => {
      expect(() => {
        loadConfig({
          env: {
            PORT: 'not-a-number',
          },
        });
      }).toThrow(FrameworkError);
    });

    it('should use custom defaults', () => {
      const config = loadConfig({
        defaults: {
          name: 'CustomApp',
          version: '2.0.0',
        },
      });

      expect(config.name).toBe('CustomApp');
      expect(config.version).toBe('2.0.0');
    });

    it('should validate all config sections', () => {
      const config = loadConfig({
        env: {
          JWT_EXPIRES_IN: '24h',
          CORS_ORIGINS: 'https://example.com',
          LOG_FORMAT: 'pretty',
        },
      });

      expect(config.security.jwtExpiresIn).toBe('24h');
      expect(config.security.corsOrigins).toBe('https://example.com');
      expect(config.logging.format).toBe('pretty');
    });

    it('should parse array environment variables', () => {
      const config = loadConfig({
        env: {
          CORS_ORIGINS: '["https://a.com", "https://b.com"]',
        },
      });

      expect(Array.isArray(config.security.corsOrigins)).toBe(true);
    });
  });

  describe('getConfigValue', () => {
    it('should get nested values by path', () => {
      const config = loadConfig({ env: {} });
      expect(getConfigValue(config, 'server.port')).toBe(3000);
      expect(getConfigValue(config, 'database.host')).toBe('localhost');
      expect(getConfigValue(config, 'logging.level')).toBe('info');
    });

    it('should return undefined for non-existent paths', () => {
      const config = loadConfig({ env: {} });
      expect(getConfigValue(config, 'nonexistent.path')).toBeUndefined();
      expect(getConfigValue(config, 'server.nonexistent')).toBeUndefined();
    });

    it('should handle empty paths', () => {
      const config = loadConfig({ env: {} });
      expect(getConfigValue(config, '')).toBeUndefined();
    });

    it('should handle deeply nested paths', () => {
      const config = loadConfig({ env: {} });
      expect(getConfigValue(config, 'security.jwtSecret')).toBeUndefined();
    });
  });

  describe('mergeConfig', () => {
    it('should merge partial configuration', () => {
      const base = loadConfig({ env: {} });
      const merged = mergeConfig(base, {
        name: 'MergedApp',
        server: { port: 9000 },
      });

      expect(merged.name).toBe('MergedApp');
      expect(merged.server.port).toBe(9000);
      expect(merged.version).toBe(base.version);
    });

    it('should override nested config', () => {
      const base = loadConfig({ env: { DATABASE_HOST: 'old-host' } });
      const merged = mergeConfig(base, {
        database: { host: 'new-host' },
      });

      expect(merged.database.host).toBe('new-host');
    });

    it('should validate merged config', () => {
      const base = loadConfig({ env: {} });

      expect(() => {
        mergeConfig(base, {
          server: { env: 'invalid-env' as any },
        });
      }).toThrow();
    });
  });

  describe('AppConfigSchema', () => {
    it('should validate valid config', () => {
      const validConfig = {
        name: 'TestApp',
        version: '1.0.0',
        database: {
          host: 'localhost',
          port: 5432,
        },
        server: {
          port: 3000,
          env: 'development',
        },
        security: {
          jwtSecret: 'secret',
        },
        logging: {
          level: 'info',
        },
      };

      const result = AppConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const config = loadConfig({ env: {} });

      expect(config.name).toBe('app');
      expect(config.version).toBe('1.0.0');
      expect(config.server.port).toBe(3000);
    });

    it('should reject invalid enum values', () => {
      const config = {
        server: { env: 'invalid-env' },
      };

      const result = AppConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should coerce string numbers via loadConfig', () => {
      const config = loadConfig({
        env: {
          PORT: '8080',
        },
      });
      expect(config.server.port).toBe(8080);
    });
  });

  describe('DatabaseConfigSchema', () => {
    it('should validate database config', () => {
      const validDb = {
        host: 'localhost',
        port: 5432,
        database: 'mydb',
        user: 'admin',
        password: 'secret',
        ssl: true,
      };

      const result = DatabaseConfigSchema.safeParse(validDb);
      expect(result.success).toBe(true);
    });

    it('should make password optional', () => {
      const dbNoPassword = {
        host: 'localhost',
        database: 'mydb',
      };

      const result = DatabaseConfigSchema.safeParse(dbNoPassword);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.password).toBeUndefined();
      }
    });

    it('should use defaults', () => {
      const minimalDb = {};
      const result = DatabaseConfigSchema.safeParse(minimalDb);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.host).toBe('localhost');
        expect(result.data.port).toBe(5432);
      }
    });
  });

  describe('ServerConfigSchema', () => {
    it('should validate server config', () => {
      const validServer = {
        port: 3000,
        host: '127.0.0.1',
        env: 'production',
      };

      const result = ServerConfigSchema.safeParse(validServer);
      expect(result.success).toBe(true);
    });

    it('should reject invalid environment', () => {
      const invalidServer = {
        env: 'staging',
      };

      const result = ServerConfigSchema.safeParse(invalidServer);
      expect(result.success).toBe(false);
    });
  });

  describe('Config module edge cases', () => {
    it('should handle special characters in strings', () => {
      const config = loadConfig({
        env: {
          APP_NAME: 'My App v1.0 [TEST]',
        },
      });

      expect(config.name).toBe('My App v1.0 [TEST]');
    });

    it('should handle deeply nested service dependencies', () => {
      // This is tested in container tests, but confirm config works
      const config = loadConfig({ env: {} });
      expect(config.name).toBe('app');
    });

    it('should handle type coercion for numbers', () => {
      const config = loadConfig({
        env: {
          DATABASE_PORT: '5433',
        },
      });
      expect(typeof config.database.port).toBe('number');
      expect(config.database.port).toBe(5433);
    });
  });
});
