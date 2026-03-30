/**
 * JWT Addon Definition
 * Self-registers with the Klusterio core framework
 */

import jwt from 'jsonwebtoken';
import { JWTService, type JWTClaims } from './service.js';

// Re-export for convenience
export { JWTService };
export type { JWTClaims };

export interface JwtConfig {
  secret: string;
  expiresIn?: string;
  algorithm?: jwt.Algorithm;
  issuer?: string;
  audience?: string;
}

/**
 * JWT Service wrapper with factory pattern
 * ADR-002 compatible - no container dependency
 */
export const JwtAddon = {
  /**
   * Create JWT service instance
   */
  async create(config: JwtConfig): Promise<JWTService> {
    return new JWTService({
      secret: config.secret,
      algorithm: config.algorithm,
      expiresIn: config.expiresIn,
      issuer: config.issuer,
      audience: config.audience,
    });
  },

  /**
   * Fastify middleware for JWT verification
   * Adds onRequest hook that sets req.user if valid token
   */
  middleware(config: JwtConfig): (fastify: unknown) => Promise<void> {
    return async (fastify: unknown) => {
      const service = await JwtAddon.create(config);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fastify as any).addHook('onRequest', async (request: any) => {
        const token = extractBearerToken(request.headers ?? {});

        if (!token) {
          request.user = null;
          return;
        }

        try {
          const claims = service.verify(token);
          request.user = { id: claims.sub, ...claims };
        } catch {
          request.user = null;
        }
      });
    };
  },

  /**
   * Create auth hook for manual verification
   */
  createAuthHook(config: JwtConfig) {
    return async (request: { headers?: { authorization?: string } }): Promise<{
      success: boolean;
      user?: { id: string; [key: string]: unknown };
      error?: string;
    }> => {
      const token = extractBearerToken(request.headers ?? {});

      if (!token) {
        return { success: false, error: 'No authorization token' };
      }

      try {
        const service = await JwtAddon.create(config);
        const claims = service.verify(token);

        return {
          success: true,
          user: { id: claims.sub, ...claims },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Invalid token',
        };
      }
    };
  },
};

/**
 * Extracts Bearer token from authorization header
 */
function extractBearerToken(headers: { authorization?: string }): string | null {
  const auth = headers.authorization;
  if (!auth) return null;

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}
