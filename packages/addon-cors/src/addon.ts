/**
 * CORS Addon — thin wrapper around @fastify/cors.
 * Keeps core dependency-free while providing first-class CORS support.
 *
 * Wrapped with fastify-plugin so it breaks encapsulation at the same level
 * as the caller's scope — otherwise @fastify/cors's skip-override only
 * propagates one level out of the double-register chain.
 */

import cors from '@fastify/cors';
import fp from 'fastify-plugin';

export interface CorsConfig {
  /**
   * Allowed origin(s). Use '*' for public APIs, specific origins for credentialed requests.
   * @default '*'
   */
  origin?: string | string[] | RegExp | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds. */
  maxAge?: number;
}

export const CorsAddon = {
  /**
   * Returns a Fastify plugin that registers CORS headers at the caller's scope.
   *
   * @example
   * ```typescript
   * const app = await createApp({ createAppContext: async () => ({}) });
   * await app.register(CorsAddon.plugin({ origin: 'https://app.example.com', credentials: true }));
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin(config: CorsConfig = {}): (fastify: any, opts: any, done: any) => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fp(async (fastify: any) => {
      await fastify.register(cors, {
        origin: config.origin ?? '*',
        methods: config.methods,
        allowedHeaders: config.allowedHeaders,
        exposedHeaders: config.exposedHeaders,
        credentials: config.credentials,
        maxAge: config.maxAge,
      });
    });
  },
};
