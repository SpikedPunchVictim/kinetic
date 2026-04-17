/**
 * defineMiddleware — typed, named Fastify preHandler factory.
 *
 * Naming every middleware makes stack traces readable and lets the introspection
 * manifest report what guards are protecting each route.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppContext, RequestContext, FastifyRequestWithContexts } from './types.js';

export interface NamedMiddleware {
  /** Human-readable identifier shown in introspection and stack traces. */
  name: string;
  fn: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;
}

/**
 * Creates a named Fastify preHandler middleware with typed app/request contexts.
 *
 * @example
 * ```typescript
 * const requireAuth = defineMiddleware('requireAuth', async (req, reply) => {
 *   const r = req as FastifyRequestWithContexts<AppCtx, ReqCtx>;
 *   if (!r.requestContext.user) reply.code(401).send({ error: 'Unauthorized' });
 * });
 *
 * app.get('/protected', { preHandler: [requireAuth.fn] }, handler);
 * ```
 */
export function defineMiddleware<
  TAppContext extends AppContext = AppContext,
  TRequestContext extends RequestContext = RequestContext,
>(
  name: string,
  fn: (
    request: FastifyRequestWithContexts<TAppContext, TRequestContext>,
    reply: FastifyReply,
  ) => Promise<void> | void,
): NamedMiddleware {
  return {
    name,
    fn: fn as (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void,
  };
}
