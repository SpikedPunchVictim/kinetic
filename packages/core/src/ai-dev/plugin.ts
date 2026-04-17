/**
 * AI Dev Plugin for Fastify
 * Automatically registers introspection routes in development mode
 * ADR-002: Removed container dependency
 */

import type { RouteDefinition } from '../types.js';
import type { Model } from '../schema/model.js';
import { ErrorCodes } from '../errors.js';
import { getEnvRegistry } from '../env.js';
import {
  getRoutesIntrospection,
  getSchemaIntrospection,
  getConventionsIntrospection,
  getErrorsIntrospection,
  getAppManifest,
} from './routes.js';

export interface IntrospectionPluginOptions {
  prefix?: string;
  routes?: RouteDefinition[];
  models?: Model[];
}

interface FastifyInstance {
  get: (path: string, handler: () => Promise<unknown>) => void;
  log?: { info: (msg: string) => void };
}

export function createIntrospectionPlugin(options: IntrospectionPluginOptions) {
  const prefix = options.prefix ?? '/__introspect';
  const routes = options.routes ?? [];
  const models = options.models ?? [];
  const errorCodes = Object.values(ErrorCodes) as string[];

  return {
    name: '@klusterio/ai-introspection',
    version: '0.1.0',

    async register(fastify: FastifyInstance) {
      // Single compact manifest — one request to understand the full app.
      // env groups are read lazily so all defineEnv() calls that ran before
      // the first request are included.
      fastify.get(`${prefix}`, async () => {
        return getAppManifest(routes, models, errorCodes, getEnvRegistry());
      });

      // Verbose sub-endpoints retained for detailed inspection.
      fastify.get(`${prefix}/routes`, async () => ({ data: getRoutesIntrospection(routes) }));
      fastify.get(`${prefix}/schema`, async () => ({ data: getSchemaIntrospection(models) }));
      fastify.get(`${prefix}/conventions`, async () => ({ data: getConventionsIntrospection() }));
      fastify.get(`${prefix}/errors`, async () => ({ data: getErrorsIntrospection() }));
      fastify.get(`${prefix}/env`, async () => ({ data: getEnvRegistry() }));
      fastify.get(`${prefix}/health`, async () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.1.0',
      }));

      if (fastify.log) {
        fastify.log.info(`AI introspection endpoints registered at ${prefix}/*`);
      }
    },
  };
}
