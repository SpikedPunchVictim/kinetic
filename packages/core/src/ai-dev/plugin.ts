/**
 * AI Dev Plugin for Fastify
 * Automatically registers introspection routes in development mode
 * ADR-002: Removed container dependency
 */

import type { RouteDefinition } from '../types.js';
import type { Model } from '../schema/model.js';
import {
  getRoutesIntrospection,
  getSchemaIntrospection,
  getConventionsIntrospection,
  getErrorsIntrospection,
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

/**
 * Creates a Fastify plugin for AI introspection routes
 *
 * @param options - Plugin options including routes and models
 * @returns Fastify plugin object with register function
 */
export function createIntrospectionPlugin(options: IntrospectionPluginOptions) {
  const prefix = options.prefix ?? '/__introspect';
  const routes = options.routes ?? [];
  const models = options.models ?? [];

  return {
    name: '@klusterio/ai-introspection',
    version: '0.1.0',

    async register(fastify: FastifyInstance) {
      // GET /__introspect/routes - Registered routes
      fastify.get(`${prefix}/routes`, async () => {
        return {
          data: getRoutesIntrospection(routes),
        };
      });

      // GET /__introspect/schema - Defined models
      fastify.get(`${prefix}/schema`, async () => {
        return {
          data: getSchemaIntrospection(models),
        };
      });

      // GET /__introspect/conventions - Framework conventions
      fastify.get(`${prefix}/conventions`, async () => {
        return {
          data: getConventionsIntrospection(),
        };
      });

      // GET /__introspect/errors - Recent errors
      fastify.get(`${prefix}/errors`, async () => {
        return {
          data: getErrorsIntrospection(),
        };
      });

      // GET /__introspect/health - Plugin health
      fastify.get(`${prefix}/health`, async () => {
        return {
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '0.1.0',
        };
      });

      if (fastify.log) {
        fastify.log.info(`AI introspection endpoints registered at ${prefix}/*`);
      }
    },
  };
}
