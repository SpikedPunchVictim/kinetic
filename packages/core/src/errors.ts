/**
 * Framework error handling with AI-optimized token-efficient format
 * ADR-002: Condensed format ~14 tokens vs ~45 tokens
 */

// Error codes (abbreviated format)
export const ErrorCodes = {
  // Initialization
  E_INIT: 'E_INIT',
  E_INIT_CONN: 'E_INIT_CONN',
  E_INIT_CFG: 'E_INIT_CFG',

  // Not Found
  E_NF: 'E_NF',
  E_NF_USER: 'E_NF_USER',
  E_NF_RESOURCE: 'E_NF_RESOURCE',

  // Validation
  E_VAL: 'E_VAL',
  E_VAL_EMAIL: 'E_VAL_EMAIL',
  E_VAL_SCHEMA: 'E_VAL_SCHEMA',

  // Database
  E_DB: 'E_DB',
  E_DB_TIMEOUT: 'E_DB_TIMEOUT',
  E_DB_CONN: 'E_DB_CONN',

  // Auth
  E_AUTH: 'E_AUTH',
  E_AUTH_JWT: 'E_AUTH_JWT',
  E_AUTH_PERM: 'E_AUTH_PERM',

  // Deprecated aliases (for migration)
  VALIDATION_ERROR: 'E_VAL',
  CYCLIC_DEPENDENCY: 'E_INIT',
  UNDEFINED_DEPENDENCY: 'E_INIT',
  INIT_FAILURE: 'E_INIT',
  NAMING_VIOLATION: 'E_VAL',
  PAGINATION_REQUIRED: 'E_VAL',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/**
 * Token-efficient error format
 * {c}ode, {s}ervice, {r}eason, {t}imestamp
 * ~14 tokens vs ~45 in verbose format
 */
export interface CondensedError {
  /** Error code (e.g., 'E_INIT', 'E_NF') */
  c: string;
  /** Service/subject (e.g., 'db', 'userService') */
  s: string;
  /** Reason/abbreviated message (e.g., 'conn_refus', 'not_found') */
  r: string;
  /** Timestamp (unix ms) */
  t: number;
}

export interface FrameworkErrorOptions {
  code: ErrorCode;
  c?: string; // Support both formats
  s?: string;
  r?: string;
  t?: number;
  // Legacy fields (deprecated)
  message?: string;
  suggestion?: string;
  docsUrl?: string;
  field?: string;
}

export class FrameworkError extends Error {
  readonly code: string;
  readonly service: string;
  readonly reason: string;
  readonly timestamp: number;
  readonly suggestion?: string;
  readonly docsUrl?: string;
  readonly field?: string;

  /**
   * Creates a FrameworkError in condensed format {c, s, r, t}
   * @param options - Error options, supports both new and legacy format
   */
  constructor(options: FrameworkErrorOptions) {
    // Build condensed message
    const code = ErrorCodes[options.code] || options.code;
    const service = options.s || options.field || 'unknown';
    // Truncate reason to 20 chars
    const rawReason = options.r ||
      (options.message ? options.message : 'unknown');
    const reason = rawReason.slice(0, 20);
    const timestamp = options.t || Date.now();

    const message = `{"c":"${code}","s":"${service}","r":"${reason}","t":${timestamp}}`;

    super(message);
    this.name = 'FrameworkError';
    this.code = code;
    this.service = service;
    this.reason = reason;
    this.timestamp = timestamp;

    // Legacy fields (for backward compatibility during transition)
    this.suggestion = options.suggestion;
    this.docsUrl = options.docsUrl;
    this.field = options.field;

    // Maintains proper stack trace for V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FrameworkError);
    }
  }

  /**
   * Returns condensed error format
   */
  toJSON(): CondensedError {
    return {
      c: this.code,
      s: this.service,
      r: this.reason,
      t: this.timestamp,
    };
  }

  /**
   * Creates a quick error in condensed format
   * Factory method for convenience
   */
  static create(code: string, service: string, reason: string): FrameworkError {
    return new FrameworkError({
      code: code as ErrorCode,
      c: code,
      s: service,
      r: reason.slice(0, 20),
      t: Date.now(),
    });
  }
}
