/**
 * Configuration submodule
 * Environment-based configuration with validation and type safety
 */

import { z } from 'zod';
import { FrameworkError, ErrorCodes } from '../errors.js';

// ============================================================================
// Configuration Schemas
// ============================================================================

export const DatabaseConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.coerce.number().default(5432),
  database: z.string().default('app'),
  user: z.string().default('app'),
  password: z.string().optional(),
  ssl: z.boolean().default(false),
  url: z.string().optional(),
});

export const ServerConfigSchema = z.object({
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  env: z.enum(['development', 'production', 'test']).default('development'),
});

export const SecurityConfigSchema = z.object({
  jwtSecret: z.string().optional(),
  jwtExpiresIn: z.string().default('1h'),
  corsOrigins: z.union([z.string(), z.array(z.string())]).default('*'),
  rateLimitWindow: z.coerce.number().default(60000),
  rateLimitMax: z.coerce.number().default(100),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  format: z.enum(['json', 'pretty']).default('json'),
  destination: z.string().optional(),
});

export const AppConfigSchema = z.object({
  name: z.string().default('app'),
  version: z.string().default('1.0.0'),
  database: DatabaseConfigSchema.default({}),
  server: ServerConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

// ============================================================================
// Types
// ============================================================================

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

// ============================================================================
// Environment Variable Loading
// ============================================================================

/**
 * Maps environment variable names to config paths
 */
const ENV_MAPPINGS: Record<string, string> = {
  // Database
  'DATABASE_HOST': 'database.host',
  'DATABASE_PORT': 'database.port',
  'DATABASE_NAME': 'database.database',
  'DATABASE_USER': 'database.user',
  'DATABASE_PASSWORD': 'database.password',
  'DATABASE_SSL': 'database.ssl',
  'DATABASE_URL': 'database.url',

  // Server
  'PORT': 'server.port',
  'HOST': 'server.host',
  'NODE_ENV': 'server.env',

  // Security
  'JWT_SECRET': 'security.jwtSecret',
  'JWT_EXPIRES_IN': 'security.jwtExpiresIn',
  'CORS_ORIGINS': 'security.corsOrigins',
  'RATE_LIMIT_WINDOW': 'security.rateLimitWindow',
  'RATE_LIMIT_MAX': 'security.rateLimitMax',

  // Logging
  'LOG_LEVEL': 'logging.level',
  'LOG_FORMAT': 'logging.format',
  'LOG_DESTINATION': 'logging.destination',

  // App
  'APP_NAME': 'name',
  'APP_VERSION': 'version',
};

/**
 * Sets a nested value in an object by path
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Parses a value to its appropriate type
 */
function parseValue(value: string): unknown {
  // Try boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Try number
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

  // Try JSON array
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // Return as string
  return value;
}

// ============================================================================
// Configuration Loading
// ============================================================================

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  defaults?: Partial<AppConfig>;
  strict?: boolean;
}

/**
 * Loads configuration from environment variables
 *
 * @param options - Configuration options
 * @returns Validated configuration object
 * @throws FrameworkError if validation fails
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const strict = options.strict ?? false;

  // Start with defaults - empty objects for nested schemas to apply their defaults
  const config: Record<string, unknown> = {
    database: {},
    server: {},
    security: {},
    logging: {},
    ...options.defaults,
  };

  // Load from environment variables
  for (const [envKey, configPath] of Object.entries(ENV_MAPPINGS)) {
    const value = env[envKey];
    if (value !== undefined) {
      setNestedValue(config, configPath, parseValue(value));
    }
  }

  // Validate - Zod will apply defaults on nested schemas
  const result = AppConfigSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    throw new FrameworkError({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Configuration validation failed',
      suggestion: `Invalid config fields: ${issues.map(i => `${i.path}: ${i.message}`).join(', ')}`,
      docsUrl: '',
    });
  }

  // Security checks in strict mode
  if (strict) {
    if (!result.data.security.jwtSecret && result.data.server.env === 'production') {
      throw new FrameworkError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'JWT_SECRET is required in production',
        suggestion: 'Set JWT_SECRET environment variable',
        docsUrl: '',
      });
    }
  }

  return result.data;
}

/**
 * Gets a configuration value by path
 *
 * @param config - Configuration object
 * @param path - Dot-separated path to the value
 * @returns The configuration value or undefined
 */
export function getConfigValue<T = unknown>(
  config: AppConfig,
  path: string
): T | undefined {
  const keys = path.split('.');
  let current: unknown = config;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current as T;
}

/**
 * Merges partial configuration into existing config
 *
 * @param base - Base configuration
 * @param override - Override values
 * @returns Merged configuration
 */
export function mergeConfig(
  base: AppConfig,
  override: Partial<AppConfig>
): AppConfig {
  const merged = {
    ...base,
    ...override,
    database: { ...base.database, ...override.database },
    server: { ...base.server, ...override.server },
    security: { ...base.security, ...override.security },
    logging: { ...base.logging, ...override.logging },
  };

  return AppConfigSchema.parse(merged);
}

// ============================================================================
// Default Export
// ============================================================================

export const config = {
  load: loadConfig,
  get: getConfigValue,
  merge: mergeConfig,
  schemas: {
    AppConfigSchema,
    DatabaseConfigSchema,
    ServerConfigSchema,
    SecurityConfigSchema,
    LoggingConfigSchema,
  },
};

export default config;
