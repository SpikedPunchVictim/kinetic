# @klusterio/addon-jwt

JWT Authentication addon for the Kinetic Framework. Provides secure JSON Web Token handling with signing, verification, and Fastify middleware integration.

## Features

- **Token Signing**: Create JWTs with configurable claims and expiration
- **Token Verification**: Verify signatures and validate claims
- **Fastify Middleware**: Automatic token extraction and user attachment
- **Flexible Algorithms**: Support for HMAC (HS256/HS384/HS512) and RSA
- **Type-Safe**: Full TypeScript support with claim type inference

## Installation

```bash
npm install @klusterio/addon-jwt
# or
pnpm add @klusterio/addon-jwt
```

## Quick Start

```typescript
import { createApp } from '@klusterio/kinetic-core';
import { JwtAddon } from '@klusterio/addon-jwt';

// Create JWT service
const jwt = await JwtAddon.create({
  secret: process.env.JWT_SECRET!, // Min 32 characters
  expiresIn: '1h',
  algorithm: 'HS256',
});

// Create app with JWT in context
const app = await createApp<{ jwt: typeof jwt }>({
  createAppContext: async () => ({ jwt }),
});

// Login endpoint - create token
app.post('/login', async (req) => {
  const { email, password } = req.body;
  const user = await authenticateUser(email, password);

  const token = app.context.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  return { token };
});

// Protected route - verify token
app.get('/profile', async (req) => {
  const token = extractBearerToken(req.headers);
  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    const claims = app.context.jwt.verify(token);
    const user = await getUser(claims.sub);
    return user;
  } catch (error) {
    throw new Error('Invalid token');
  }
});
```

## Configuration

```typescript
interface JwtConfig {
  secret: string;              // Required: Signing secret (min 32 chars)
  expiresIn?: string | number; // Default: '1h' (e.g., '1h', '7d', 3600)
  algorithm?: jwt.Algorithm;   // Default: 'HS256'
  issuer?: string;             // Optional: Token issuer
  audience?: string;             // Optional: Token audience
}
```

### Algorithm Options

| Algorithm | Type | Use Case |
|-----------|------|----------|
| HS256 | HMAC | Symmetric - same secret for signing/verifying |
| HS384 | HMAC | Stronger HMAC variant |
| HS512 | HMAC | Strongest HMAC variant |
| RS256 | RSA | Asymmetric - public key for verification |
| RS384 | RSA | Stronger RSA variant |
| RS512 | RSA | Strongest RSA variant |
| ES256 | ECDSA | Elliptic curve (smaller signatures) |

## Usage Examples

### Basic Token Signing

```typescript
import { JwtAddon } from '@klusterio/addon-jwt';

const jwt = await JwtAddon.create({
  secret: 'your-256-bit-secret-minimum-32-characters-long',
});

// Create token
const token = jwt.sign({
  sub: 'user-123',
  email: 'user@example.com',
  role: 'admin',
});
// Returns: eyJhbGciOiJIUzI1NiIs...
```

### Token Verification
```typescript
try {
  const claims = jwt.verify(token);
  console.log(claims.sub);  // 'user-123'
  console.log(claims.email); // 'user@example.com'
  console.log(claims.role);  // 'admin'
} catch (error) {
  if (error instanceof TokenExpiredError) {
    throw new Error('Token has expired');
  }
  throw new Error('Invalid token');
}
```

### Automatic Middleware Verification

```typescript
// Register middleware
await JwtAddon.middleware({
  secret: process.env.JWT_SECRET!,
})(fastify);

// Routes automatically get req.user
app.get('/profile', async (req) => {
  // req.user is set by middleware if valid token present
  if (!req.user) {
    throw new Error('Unauthorized');
  }
  return await getUser(req.user.id);
});
```

### Custom Auth Hook

```typescript
// For custom authentication logic
const authHook = JwtAddon.createAuthHook({
  secret: process.env.JWT_SECRET!,
});

app.get('/admin', async (req) => {
  const result = await authHook(req);

  if (!result.success) {
    return { error: result.error };
  }

  if (result.user?.role !== 'admin') {
    return { error: 'Forbidden' };
  }

  return await getAdminData();
});
```

### Token Decoding (without verification)

```typescript
// Decode without verifying signature
const claims = jwt.decode(token);
console.log(claims?.sub);

// Decode with full header
const decoded = jwt.decodeComplete(token);
console.log(decoded?.header.alg); // 'HS256'
console.log(decoded?.payload.sub);
```

### Token Expiration Management

```typescript
// Check if token is expired
const isExpired = jwt.isExpired(token);

// Get expiration timestamp
const exp = jwt.getExpiration(token);
if (exp) {
  const expiresIn = exp - Math.floor(Date.now() / 1000);
  console.log(`Token expires in ${expiresIn} seconds`);
}
```

## API Reference

### JwtAddon

#### `create(config: JwtConfig): Promise<JWTService>`

Creates and initializes a JWT service instance.

#### `middleware(config: JwtConfig): (fastify: FastifyInstance) => Promise<void>`

Returns Fastify middleware that:
- Extracts Bearer token from Authorization header
- Verifies token signature and expiration
- Sets `req.user` with decoded claims
- Sets `req.user = null` if no/invalid token

#### `createAuthHook(config: JwtConfig): (request) => Promise<AuthResult>`

Creates a reusable auth hook for manual verification.

Returns `AuthResult`:
```typescript
{
  success: boolean;
  user?: { id: string; [key: string]: unknown };
  error?: string;
}
```

### JWTService

#### `sign(payload: JWTClaims, options?: SignOptions): string`

Creates a signed JWT token.

```typescript
interface JWTClaims {
  sub: string;                    // Subject (user ID) - required
  iss?: string;                   // Issuer
  aud?: string | string[];       // Audience
  exp?: number;                   // Expiration (Unix timestamp)
  iat?: number;                   // Issued at (auto-set)
  nbf?: number;                   // Not before
  jti?: string;                   // JWT ID
  [key: string]: unknown;        // Custom claims
}
```

#### `verify(token: string, options?: JWTVerifyOptions): JWTClaims`

Verifies token signature and returns decoded claims.

#### `decode(token: string): JWTClaims | null`

Decodes token without verifying signature.

#### `decodeComplete(token: string): DecodedToken | null`

Decodes with full header information.

#### `isExpired(token: string): boolean`

Checks if token is expired (catches TokenExpiredError).

#### `getExpiration(token: string): number | null`

Returns expiration timestamp or null.

## Error Handling

```typescript
import { TokenExpiredError, JsonWebTokenError } from '@klusterio/addon-jwt';

try {
  jwt.verify(token);
} catch (error) {
  if (error instanceof TokenExpiredError) {
    // Token expired at error.expiredAt
    return { error: 'Session expired' };
  }

  if (error instanceof JsonWebTokenError) {
    // Invalid signature, malformed token, etc.
    return { error: 'Invalid token' };
  }
}
```

### Error Messages Helper

```typescript
import { getJWTErrorMessage } from '@klusterio/addon-jwt';

try {
  jwt.verify(token);
} catch (error) {
  const { code, message, suggestion } = getJWTErrorMessage(error);
  console.log({ code, message, suggestion });
  // { code: 'TOKEN_EXPIRED', message: 'JWT token has expired', suggestion: '...' }
}
```

## TypeScript Integration

### Declaring User Types

Extend Fastify types for type-safe access:

```typescript
// types.d.ts
declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      role: string;
    } | null;
  }
}
```

### Custom Claims

```typescript
import { JWTClaims } from '@klusterio/addon-jwt';

interface MyClaims extends JWTClaims {
  role: 'admin' | 'user' | 'guest';
  permissions: string[];
}

// Type-safe signing
const token = jwt.sign({
  sub: 'user-123',
  email: 'user@example.com',
  role: 'admin',        // TypeScript validates
  permissions: ['read', 'write'],
} as MyClaims);
```

## Security Best Practices

### Secret Management

1. **Environment Variables**: Never hardcode secrets
   ```typescript
   const jwt = await JwtAddon.create({
     secret: process.env.JWT_SECRET!, // Type assertion if non-null
   });
   ```

2. **Minimum Length**: 32+ characters for HMAC algorithms
3. **Rotation**: Implement secret rotation for production
4. **Asymmetric Keys**: Use RS256/ES256 for distributed systems

### Token Storage (Client-Side)

```typescript
// Good: HttpOnly cookies
res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Secure; SameSite=Strict`);

// Avoid: localStorage (XSS vulnerable)
// localStorage.setItem('token', token);  // ❌ Don't do this
```

### Claims Design

```typescript
// Include only necessary claims
const token = jwt.sign({
  sub: user.id,           // Required - user identifier
  iat: Date.now() / 1000, // Issued at (auto)
  exp: Date.now() / 1000 + 3600, // Expire 1 hour (auto from expiresIn)
  // Avoid sensitive data:
  // ❌ password: user.password_hash,
  // ❌ ssn: user.social_security,
});
```

### Verification Options

```typescript
// Always verify issuer and audience in production
jwt.verify(token, {
  issuer: 'https://myapp.com',
  audience: 'my-app-client',
  algorithms: ['HS256'], // Whitelist allowed algorithms
});
```

## Development

### Running Tests

```bash
pnpm test
```

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

## Troubleshooting

### "JWT secret must be at least 32 characters"

Use a cryptographically secure secret:
```bash
# Generate secure secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### "invalid signature"

- Verify secret matches between signing and verification
- Check algorithm matches on both sides
- For RS256, ensure private key signs and public key verifies

### "jwt expired"

- Check system clock is synchronized
- Verify `expiresIn` is appropriate for use case
- Consider refresh token pattern for long sessions

## License

MIT