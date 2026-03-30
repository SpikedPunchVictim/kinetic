/**
 * Application bootstrap with explicit factory pattern
 * ADR-002: Replaces container-based DI with compile-time safe factories
 */

import Fastify from 'fastify';
import type {
  CreateAppOptions,
  FastifyWithContext,
  AppContext,
  RequestContext,
} from './types.js';
import { FrameworkError, ErrorCodes } from './errors.js';

/**
 * Creates Fastify application with typed contexts
 *
 * @example
 * ```typescript
 * const app = await createApp<{ db: Database }>({
 *   createAppContext: async () => ({
 *     db: await DbAddon.create(env.DATABASE_URL),
 *   }),
 * });
 *
 * // Access context
 * await app.context.db.query('SELECT 1');
 * ```
 */
export async function createApp<
  TAppContext extends AppContext,
  TRequestContext extends RequestContext = {}
>(
  options: CreateAppOptions<TAppContext, TRequestContext>
): Promise<FastifyWithContext<TAppContext>> {
  // Create Fastify instance
  const fastify = Fastify(options.fastifyOptions ?? {});

  try {
    // Add JSON body parser (core feature)
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      try {
        const json = JSON.parse(body as string);
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    // Create app-level context
    const appContext = await options.createAppContext();

    // Decorate Fastify with app context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fastify as any).context = appContext;

    // Set up request context hook if provided
    // Use 'requestContext' to avoid conflict with Fastify's built-in 'context' property
    if (options.createRequestContext) {
      fastify.addHook('onRequest', async (request) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).appContext = appContext;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).requestContext = await options.createRequestContext!(request, appContext);
      });
    } else {
      // Still decorate with appContext reference for type safety
      fastify.addHook('onRequest', async (request) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).appContext = appContext;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).requestContext = {} as TRequestContext;
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (fastify as any) as FastifyWithContext<TAppContext>;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message.slice(0, 20) : 'unknown';
    throw new FrameworkError({
      code: ErrorCodes.E_INIT,
      c: 'E_INIT',
      s: 'createApp',
      r: errorMessage,
      t: Date.now(),
    });
  }
}
