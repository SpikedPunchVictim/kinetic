/**
 * JWT Service using the jsonwebtoken library
 * Implements proper JWT signing, verification, and decoding per RFC 7519
 */

import jwt, {
  SignOptions,
  VerifyOptions,
  JwtPayload,
  JsonWebTokenError,
  TokenExpiredError,
} from 'jsonwebtoken';

// ============================================================================
// Types
// ============================================================================

export interface JWTClaims extends Record<string, unknown> {
  sub: string;        // Subject (user ID)
  iss?: string;       // Issuer
  aud?: string | string[];  // Audience
  exp?: number;       // Expiration time (Unix timestamp)
  iat?: number;       // Issued at (Unix timestamp)
  nbf?: number;       // Not before (Unix timestamp)
  jti?: string;       // JWT ID
}

export interface JWTServiceOptions {
  secret: string;
  algorithm?: jwt.Algorithm;
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
}

export interface JWTVerifyOptions {
  algorithms?: jwt.Algorithm[];
  audience?: string | RegExp | Array<string | RegExp>;
  issuer?: string;
  maxAge?: string | number;
  clockTolerance?: number;
}

export interface DecodedToken {
  header: { alg: string; typ: string };
  payload: JWTClaims;
  signature: string;
}

// ============================================================================
// JWT Service Implementation
// ============================================================================

export class JWTService {
  private secret: string;
  private defaultOptions: SignOptions;

  constructor(options: JWTServiceOptions) {
    this.secret = options.secret;
    if (!this.secret || this.secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }

    this.defaultOptions = {
      algorithm: options.algorithm || 'HS256',
      expiresIn: options.expiresIn || '1h',
      ...(options.issuer ? { issuer: options.issuer } : {}),
      ...(options.audience ? { audience: options.audience } : {}),
    } as SignOptions;
  }

  /**
   * Sign a JWT token
   * @param payload - Claims to include in the token
   * @param options - Override default sign options
   * @returns The signed JWT token
   */
  sign(payload: Omit<JWTClaims, 'iat'>, options?: SignOptions): string {
    const signOptions: SignOptions = {
      ...this.defaultOptions,
      ...options,
    };

    return jwt.sign(payload, this.secret, signOptions);
  }

   /**
   * Verify and decode a JWT token
   * @param token - The JWT token to verify
   * @param options - Verification options
   * @returns The decoded payload
   * @throws {TokenExpiredError} If token is expired
   * @throws {JsonWebTokenError} If token is invalid
   */
  verify(token: string, options?: JWTVerifyOptions): JWTClaims {
    const verifyOptions: VerifyOptions = {
      algorithms: options?.algorithms || ['HS256'],
      issuer: options?.issuer,
      clockTolerance: options?.clockTolerance,
    };

    if (options?.maxAge !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (verifyOptions as any).maxAge = options.maxAge;
    }

    if (options?.audience !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (verifyOptions as any).audience = options.audience;
    }

    const decoded = jwt.verify(token, this.secret, verifyOptions);
    return decoded as JWTClaims;
  }

  /**
   * Decode a token without verification
   * @param token - The JWT token
   * @returns Decoded payload or null if invalid format
   */
  decode(token: string): JWTClaims | null {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === 'string') {
      return null;
    }
    return decoded as JWTClaims;
  }

  /**
   * Decode with complete header information
   * @param token - The JWT token
   * @returns Full decoded token with header, payload, and signature
   */
  decodeComplete(token: string): DecodedToken | null {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      return null;
    }
    return {
      header: decoded.header as { alg: string; typ: string },
      payload: decoded.payload as JWTClaims,
      signature: decoded.signature,
    };
  }

  /**
   * Check if a token is expired
   * @param token - The JWT token
   * @returns True if expired or invalid
   */
  isExpired(token: string): boolean {
    try {
      this.verify(token);
      return false;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        return true;
      }
      return false;
    }
  }

  /**
   * Get token expiration time
   * @param token - The JWT token
   * @returns Expiration timestamp or null
   */
  getExpiration(token: string): number | null {
    const decoded = this.decode(token);
    return decoded?.exp || null;
  }
}

// ============================================================================
// Error Handling
// ============================================================================

export { JsonWebTokenError, TokenExpiredError };

/**
 * Human-readable error messages for JWT errors
 */
export function getJWTErrorMessage(error: unknown): { code: string; message: string; suggestion: string } {
  if (error instanceof TokenExpiredError) {
    return {
      code: 'TOKEN_EXPIRED',
      message: 'JWT token has expired',
      suggestion: 'Request a new token by logging in again',
    };
  }

  if (error instanceof JsonWebTokenError) {
    if (error.message.includes('invalid signature')) {
      return {
        code: 'INVALID_SIGNATURE',
        message: 'JWT signature is invalid',
        suggestion: 'Token may have been tampered with or wrong secret is being used',
      };
    }
    if (error.message.includes('invalid token')) {
      return {
        code: 'INVALID_TOKEN',
        message: 'JWT token format is invalid',
        suggestion: 'Check that the token is complete and properly formatted',
      };
    }
    return {
      code: 'JWT_ERROR',
      message: error.message,
      suggestion: 'Check token format and verify with the correct secret',
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
    suggestion: 'Contact support if this persists',
  };
}
