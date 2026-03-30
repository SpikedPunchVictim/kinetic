/**
 * CRUD route generation with factory pattern
 * ADR-002: Uses ICrud interface for actual implementation
 */

import type {
  Model, RouteDefinition, HttpMethod,
  ICrud, Middleware, RouteHandler,
} from '../types.js';
import { generateUrlPath } from './conventions.js';

// ============================================================================
// CRUD Options Types
// ============================================================================

export interface CrudOperationOptions {
  enabled: boolean;
  middleware?: Middleware[];
  pagination?: boolean; // Only for list operations
  handler?: RouteHandler;
}

export interface CrudOptions {
  create?: CrudOperationOptions;
  read?: CrudOperationOptions & { pagination?: boolean };
  update?: CrudOperationOptions;
  delete?: CrudOperationOptions;
}

export interface CrudRouteConfig<T, CreateInput, UpdateInput> {
  store: ICrud<T, CreateInput, UpdateInput>;
}

// ============================================================================
// Route Generation
// ============================================================================

/**
 * Generates CRUD routes for a model using ICrud store interface
 *
 * @example
 * ```typescript
 * const routes = generateCrudRoutes(UserModel, {
 *   store: new MemoryStore(),
 * });
 * ```
 */
export function generateCrudRoutes<T extends { id: string }>(
  model: Model,
  config: { store: ICrud<T> },
  options: CrudOptions = {}
): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const basePath = generateUrlPath(model.name);
  const detailPath = `${basePath}/:id`;

  const { store } = config;

  // Default options - all operations enabled by default
  const defaults: CrudOptions = {
    create: { enabled: true },
    read: { enabled: true, pagination: false },
    update: { enabled: true },
    delete: { enabled: true },
  };

  const opts = { ...defaults, ...options };

  // CREATE - POST /resources (no Fastify schema - use Zod directly in handler)
  if (opts.create?.enabled) {
    routes.push({
      method: 'POST' as HttpMethod,
      path: basePath,
      handler: createHandler(store, 'create', model.inputSchema),
    });
  }

  // READ - GET /resources (list)
  if (opts.read?.enabled) {
    routes.push({
      method: 'GET' as HttpMethod,
      path: basePath,
      handler: opts.read.handler ?? createListHandler(store),
    });

    // Get by ID
    routes.push({
      method: 'GET' as HttpMethod,
      path: detailPath,
      handler: createHandler(store, 'getById'),
    });
  }

  // UPDATE - PUT /resources/:id
  if (opts.update?.enabled) {
    routes.push({
      method: 'PUT' as HttpMethod,
      path: detailPath,
      handler: createHandler(store, 'update', model.inputSchema),
    });
  }

  // DELETE - DELETE /resources/:id
  if (opts.delete?.enabled) {
    routes.push({
      method: 'DELETE' as HttpMethod,
      path: detailPath,
      handler: createHandler(store, 'delete'),
    });
  }

  return routes;
}

// ============================================================================
// Handler Factories
// ============================================================================

import { z } from 'zod';

function createHandler<T extends { id: string }>(
  store: ICrud<T>,
  operation: 'create' | 'getById' | 'update' | 'delete',
  bodySchema?: z.ZodType
): RouteHandler {
  return async (request, reply): Promise<unknown> => {
    // Validate body if schema provided
    if (bodySchema && request.body) {
      const result = bodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: result.error.message,
        });
      }
    }

    switch (operation) {
      case 'create': {
        const result = await store.create(request.body as never);
        return reply.code(201).send(result);
      }

      case 'getById': {
        const { id } = request.params as { id: string };
        const result = await store.findById(id);
        if (!result) {
          return reply.code(404).send({ error: 'Not found' });
        }
        return reply.code(200).send(result);
      }

      case 'update': {
        const { id } = request.params as { id: string };
        const result = await store.update(id, request.body as never);
        return reply.code(200).send(result);
      }

      case 'delete': {
        const { id } = request.params as { id: string };
        await store.delete(id);
        return reply.code(204).send();
      }

      default:
        return reply.code(500).send({ error: 'Unknown operation' });
    }
  };
}

function createListHandler<T extends { id: string }>(
  store: ICrud<T>
): RouteHandler {
  return async (request, reply): Promise<unknown> => {
    // Parse pagination from query
    const { cursor, limit } = request.query as { cursor?: string; limit?: string };

    const results = await store.findAll({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return reply.code(200).send(results);
  };
}

// Re-export ICrud for convenience
export type { ICrud } from '../types.js';
