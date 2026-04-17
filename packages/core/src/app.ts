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

export async function createApp<
  TAppContext extends AppContext,
  TRequestContext extends RequestContext = {}
>(
  options: CreateAppOptions<TAppContext, TRequestContext>
): Promise<FastifyWithContext<TAppContext>> {
  const gracefulShutdown = options.gracefulShutdown ?? true;
  const requestLogging = options.requestLogging ?? true;

  // Use Fastify's built-in requestIdHeader to propagate x-request-id from
  // callers, and genReqId to produce UUIDs when no header is present.
  // Both can be overridden via fastifyOptions.
  const fastifyOptions = {
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    ...options.fastifyOptions,
  };

  const fastify = Fastify(fastifyOptions);

  try {
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    // Echo request ID back on every response so callers can correlate logs.
    fastify.addHook('onSend', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });

    // Structured request/response logging via Fastify's bound Pino instance.
    if (requestLogging) {
      fastify.addHook('onRequest', async (request) => {
        request.log.info(
          { requestId: request.id, method: request.method, url: request.url, ip: request.ip },
          'incoming request',
        );
      });

      fastify.addHook('onResponse', async (request, reply) => {
        request.log.info(
          {
            requestId: request.id,
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            latencyMs: reply.elapsedTime,
          },
          'request completed',
        );
      });
    }

    const appContext = await options.createAppContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fastify as any).context = appContext;

    if (options.createRequestContext) {
      fastify.addHook('onRequest', async (request) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).appContext = appContext;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).requestContext = await options.createRequestContext!(request, appContext);
      });
    } else {
      fastify.addHook('onRequest', async (request) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).appContext = appContext;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as any).requestContext = {} as TRequestContext;
      });
    }

    if (gracefulShutdown && process.env.NODE_ENV !== 'test') {
      const shutdown = async () => {
        fastify.log.info('shutdown signal received, draining server');
        await fastify.close();
        process.exit(0);
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
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
