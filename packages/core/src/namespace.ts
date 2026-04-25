import type { FastifyInstance, FastifyReply, RouteHandlerMethod } from 'fastify';
import type {
  AppContext,
  RequestContext,
  FastifyWithContext,
  FastifyRequestWithContexts,
} from './types.js';

export type NamespaceOptions<
  TMainAppCtx extends AppContext,
  TNSAppCtx extends Record<string, unknown>,
  TNSReqCtx extends Record<string, unknown>,
> = {
  createAppContext: (appCtx: TMainAppCtx) => Promise<TNSAppCtx>;
  createRequestContext: (
    req: import('fastify').FastifyRequest,
    appCtx: TNSAppCtx,
  ) => Promise<TNSReqCtx>;
};

export type NamespaceWrapper<
  TName extends string,
  TNSCtx extends Record<string, unknown>,
> = <
  TAppCtx extends AppContext = AppContext,
  TReqCtx extends RequestContext = RequestContext,
>(
  handler: (
    req: FastifyRequestWithContexts<TAppCtx, TReqCtx> & Record<TName, TNSCtx>,
    reply: FastifyReply,
  ) => Promise<unknown> | unknown,
) => RouteHandlerMethod;

export async function defineNamespace<
  TMainAppCtx extends AppContext,
  TNSAppCtx extends Record<string, unknown>,
  TNSReqCtx extends Record<string, unknown>,
  TName extends string,
>(
  app: FastifyWithContext<TMainAppCtx>,
  name: TName,
  options: NamespaceOptions<TMainAppCtx, TNSAppCtx, TNSReqCtx>,
): Promise<NamespaceWrapper<TName, TNSAppCtx & TNSReqCtx>> {
  const fastify = app as unknown as FastifyInstance;

  if ((fastify as any).server?.listening) {
    throw new Error(
      `defineNamespace('${name}') called after the server is already listening. Register namespaces before starting the server.`,
    );
  }

  const nsAppCtx = await options.createAppContext(app.context);

  fastify.decorateRequest(name, null as any);

  fastify.addHook('onRequest', async (request) => {
    const nsReqCtx = await options.createRequestContext(request, nsAppCtx);
    (request as any)[name] = { ...nsAppCtx, ...nsReqCtx };
  });

  return (handler) => handler as unknown as RouteHandlerMethod;
}
