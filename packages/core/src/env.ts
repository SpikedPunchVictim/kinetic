/**
 * defineEnv — validate and consume environment variables with minimal boilerplate.
 *
 * Designed for per-module use: each module declares only the vars it needs.
 * All calls register their group in a global manifest so /__introspect
 * surfaces the full env surface in one request.
 *
 * Use z.coerce.number() / z.coerce.boolean() for non-string vars since
 * process.env values are always strings.
 */

import { z } from 'zod';
import { FrameworkError, ErrorCodes } from './errors.js';

// ============================================================================
// Types
// ============================================================================

type EnvSchema = Record<string, z.ZodType>;

/** Inferred type of the validated env object returned by defineEnv. */
export type EnvResult<T extends EnvSchema> = { [K in keyof T]: z.infer<T[K]> };

export interface EnvGroup {
  required: string[];
  optional: string[];
}

// ============================================================================
// Global registry — accumulated across all defineEnv() calls at module load.
// ============================================================================

const registry = new Map<string, EnvGroup>();

/** Returns all registered env groups. Used by the introspection manifest. */
export function getEnvRegistry(): Record<string, EnvGroup> {
  return Object.fromEntries(registry);
}

/** Clears the registry. Intended for use in tests only. */
export function clearEnvRegistry(): void {
  registry.clear();
}

// ============================================================================
// Implementation
// ============================================================================

function classifyKeys(schema: EnvSchema): EnvGroup {
  const required: string[] = [];
  const optional: string[] = [];

  for (const [key, type] of Object.entries(schema)) {
    if (type instanceof z.ZodOptional || type instanceof z.ZodDefault) {
      optional.push(key);
    } else {
      required.push(key);
    }
  }

  return { required, optional };
}

/**
 * Validates a group of environment variables against a Zod schema.
 *
 * - Validates all vars at once and throws a single FrameworkError listing
 *   every missing or invalid key — no hunting for the next error.
 * - Registers the group in the global manifest for /__introspect.
 * - Call once per module at the top level so failures surface at startup.
 *
 * @param group  Short identifier shown in errors and the manifest (e.g. 'db', 'cache').
 * @param schema Flat object of { ENV_VAR_NAME: ZodType }. Use z.coerce for non-strings.
 * @param source Override the env source (defaults to process.env). Useful in tests.
 *
 * @example
 * ```typescript
 * // db/config.ts
 * export const dbEnv = defineEnv('db', {
 *   DATABASE_URL: z.string().url(),
 *   DB_POOL_SIZE: z.coerce.number().default(10),
 * });
 * ```
 */
export function defineEnv<T extends EnvSchema>(
  group: string,
  schema: T,
  source: Record<string, string | undefined> = process.env,
): EnvResult<T> {
  // Register group metadata regardless of validation outcome so the manifest
  // always reflects what the module expects.
  registry.set(group, classifyKeys(schema));

  // Extract only the declared keys from the source so Zod doesn't see
  // unrelated env vars as unexpected fields.
  const subset = Object.fromEntries(
    Object.keys(schema).map(k => [k, source[k]]),
  );

  const result = z.object(schema).safeParse(subset);

  if (!result.success) {
    // Collect all failing keys (deduplicated) for a single actionable error.
    const failingKeys = [
      ...new Set(result.error.issues.map(i => String(i.path[0]))),
    ];
    // Compact reason: first 20 chars of comma-joined failing key names.
    const reason = failingKeys.join(',').slice(0, 20);

    throw new FrameworkError({
      code: ErrorCodes.E_INIT_CFG,
      c: ErrorCodes.E_INIT_CFG,
      s: group,
      r: reason,
      t: Date.now(),
    });
  }

  return result.data as EnvResult<T>;
}
