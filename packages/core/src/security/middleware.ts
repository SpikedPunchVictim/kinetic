/**
 * Security middleware implementations
 * Request validation, rate limiting, and authentication hooks
 */

import type { z } from 'zod';
import { FrameworkError, ErrorCodes } from '../errors.js';

// ============================================================================
// Types
// ============================================================================

export interface ValidationMiddleware {
  (request: { body: unknown }, reply: unknown): Promise<void> | void;
}

export interface RateLimitOptions {
  max: number;      // Maximum requests allowed
  window: number;   // Time window in seconds
  key?: (request: { ip?: string; headers?: Record<string, unknown> }) => string;
}

export interface RateLimitMiddleware {
  (request: unknown, reply: unknown): Promise<void> | void;
}

export interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    [key: string]: unknown;
  };
  error?: string;
}

export interface AuthHook {
  (request: unknown, reply: unknown): Promise<AuthResult> | AuthResult;
}

export interface Policy {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete';
}

export interface AuthzResult {
  allowed: boolean;
  error?: string;
}

export interface AuthzHook {
  (request: unknown, reply: unknown, policy: Policy): Promise<AuthzResult> | AuthzResult;
}

// ============================================================================
// In-Memory Rate Limit Store (Production would use Redis)
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function getRateLimitKey(request: { ip?: string; headers?: Record<string, unknown> }): string {
  // Default to IP-based rate limiting
  return request.ip ?? 'unknown';
}

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetTime <= now) {
      rateLimitStore.delete(key);
    }
  }
}

// ============================================================================
// Validation Middleware
// ============================================================================

/**
 * Creates a request body validation middleware using Zod schema
 *
 * @param schema - Zod schema to validate against
 * @returns Middleware function that validates request body
 */
export function validateBody(schema: z.ZodType): ValidationMiddleware {
  return async (request: { body: unknown }, _reply: unknown): Promise<void> => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      const issues = result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      throw new FrameworkError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Request body validation failed',
        suggestion: `Invalid fields: ${issues.map(i => `${i.path}: ${i.message}`).join(', ')}`,
        docsUrl: '',
      });
    }

    // Replace body with parsed/cleaned data
    request.body = result.data;
  };
}

// ============================================================================
// Rate Limiting Middleware
// ============================================================================

/**
 * Creates a rate limiting middleware
 *
 * @param options - Rate limit configuration
 * @returns Middleware function that enforces rate limits
 */
export function rateLimit(options: RateLimitOptions): RateLimitMiddleware {
  const { max, window } = options;

  return async (request: unknown, _reply: unknown): Promise<void> => {
    const key = options.key?.(request as { ip?: string }) ?? getRateLimitKey(request as { ip?: string });
    const now = Date.now();
    const windowMs = window * 1000;

    // Cleanup old entries periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
      cleanupExpiredEntries();
    }

    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime <= now) {
      // First request in new window
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return;
    }

    if (entry.count >= max) {
      // Rate limit exceeded
      throw new FrameworkError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Rate limit exceeded',
        suggestion: `Too many requests. Please wait ${Math.ceil((entry.resetTime - now) / 1000)} seconds.`,
        docsUrl: '',
      });
    }

    // Increment counter
    entry.count++;
  };
}

// ============================================================================
// Authentication Hooks
// ============================================================================

/**
 * Creates an authentication hook
 *
 * @param verifyFn - Function to verify authentication
 * @returns Auth hook function
 */
export function createAuthHook(
  verifyFn: (request: unknown) => Promise<AuthResult> | AuthResult
): AuthHook {
  return async (request: unknown, _reply: unknown): Promise<AuthResult> => {
    return verifyFn(request);
  };
}

/**
 * Creates an authorization hook
 *
 * @param checkFn - Function to check authorization
 * @returns Authz hook function
 */
export function createAuthzHook(
  checkFn: (request: unknown, policy: Policy) => Promise<AuthzResult> | AuthzResult
): AuthzHook {
  return async (request: unknown, _reply: unknown, policy: Policy): Promise<AuthzResult> => {
    return checkFn(request, policy);
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extracts bearer token from Authorization header
 *
 * @param headers - Request headers
 * @returns Token string or null
 */
export function extractBearerToken(headers: { authorization?: string }): string | null {
  const auth = headers.authorization;
  if (!auth) return null;

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}
