/**
 * CRUD Route Generation Tests
 * Tests actual features: ICrud interface, generateCrudRoutes, MemoryStore
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { defineModel } from '../src/schema/model.js';
import { generateCrudRoutes } from '../src/schema/routes.js';
import { MemoryStore } from '../src/crud/store.js';
import { createApp } from '../src/app.js';
import type { Model } from '../src/types.js';

// Test model
const UserModel = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    age: z.number().optional(),
  },
});

type User = {
  id: string;
  email: string;
  name: string;
  age?: number;
};

describe('CRUD Route Generation', () => {
  let store: MemoryStore<User>;
  let app: Awaited<ReturnType<typeof createApp<{ store: MemoryStore<User> }>>>;

  beforeEach(async () => {
    store = new MemoryStore<User>();
    app = await createApp<{ store: MemoryStore<User> }>({
      createAppContext: async () => ({ store }),
    });
  });

  describe('route generation', () => {
    it('should generate all CRUD routes by default', () => {
      const routes = generateCrudRoutes(UserModel, { store });

      expect(routes).toHaveLength(5); // POST, GET (list), GET (by id), PUT, DELETE

      const methods = routes.map(r => r.method);
      expect(methods).toContain('POST');
      expect(methods).toContain('GET');
      expect(methods).toContain('PUT');
      expect(methods).toContain('DELETE');
    });

    it('should generate correct paths', () => {
      const routes = generateCrudRoutes(UserModel, { store });

      const paths = routes.map(r => r.path);
      expect(paths).toContain('/users'); // Collection
      expect(paths).toContain('/users/:id'); // Resource
    });

    it('should disable CREATE when specified in options', () => {
      const routes = generateCrudRoutes(UserModel, { store }, {
        create: { enabled: false },
      });

      const createRoute = routes.find(r => r.method === 'POST');
      expect(createRoute).toBeUndefined();
    });

    it('should disable READ when specified', () => {
      const routes = generateCrudRoutes(UserModel, { store }, {
        read: { enabled: false },
      });

      const readRoutes = routes.filter(r => r.method === 'GET');
      expect(readRoutes).toHaveLength(0);
    });

    it('should disable UPDATE when specified', () => {
      const routes = generateCrudRoutes(UserModel, { store }, {
        update: { enabled: false },
      });

      const updateRoute = routes.find(r => r.method === 'PUT');
      expect(updateRoute).toBeUndefined();
    });

    it('should disable DELETE when specified', () => {
      const routes = generateCrudRoutes(UserModel, { store }, {
        delete: { enabled: false },
      });

      const deleteRoute = routes.find(r => r.method === 'DELETE');
      expect(deleteRoute).toBeUndefined();
    });
  });

  describe('MemoryStore ICrud implementation', () => {
    it('should create entity with generated id', async () => {
      const result = await store.create({
        email: 'alice@example.com',
        name: 'Alice',
      });

      expect(result.id).toBeDefined();
      expect(result.email).toBe('alice@example.com');
      expect(result.name).toBe('Alice');
    });

    it('should find by id', async () => {
      const created = await store.create({ email: 'test@test.com', name: 'Test' });
      const found = await store.findById(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('should return null for non-existent id', async () => {
      const found = await store.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should find all without pagination', async () => {
      await store.create({ email: 'a@test.com', name: 'A' });
      await store.create({ email: 'b@test.com', name: 'B' });

      const all = await store.findAll();
      expect(all).toHaveLength(2);
    });

    it('should support limit in findAll', async () => {
      await store.create({ email: 'a@test.com', name: 'A' });
      await store.create({ email: 'b@test.com', name: 'B' });
      await store.create({ email: 'c@test.com', name: 'C' });

      const limited = await store.findAll({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should update entity', async () => {
      const created = await store.create({ email: 'test@test.com', name: 'Original' });
      const updated = await store.update(created.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
      expect(updated.email).toBe('test@test.com'); // Unchanged
    });

    it('should throw on update for non-existent id', async () => {
      await expect(store.update('non-existent', { name: 'Test' }))
        .rejects.toThrow('Not found');
    });

    it('should delete entity', async () => {
      const created = await store.create({ email: 'test@test.com', name: 'Test' });
      await store.delete(created.id);

      const found = await store.findById(created.id);
      expect(found).toBeNull();
    });

    it('should support cursor-based pagination', async () => {
      // Create multiple items
      const item1 = await store.create({ email: 'a@test.com', name: 'A' });
      await store.create({ email: 'b@test.com', name: 'B' });
      await store.create({ email: 'c@test.com', name: 'C' });

      // Get first page
      const page1 = await store.findAll({ limit: 2 });
      expect(page1).toHaveLength(2);

      // Get next page using cursor
      const lastId = page1[page1.length - 1]?.id;
      const page2 = await store.findAll({ cursor: lastId, limit: 2 });
      expect(page2).toHaveLength(1); // Only remaining item
      expect(page2[0].id).not.toBe(item1.id); // Should not include first page items
    });

    it('should handle cursor that does not exist gracefully', async () => {
      await store.create({ email: 'a@test.com', name: 'A' });
      const items = await store.findAll({ cursor: 'non-existent-id' });
      expect(items.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('route handlers - integration', () => {
    it('should create entity through route', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'test@example.com', name: 'Test User' },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.email).toBe('test@example.com');
      expect(body.id).toBeDefined();
    });

    it('should return 404 for non-existent resource', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/users/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should get entity by id through route', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      // Create entity first
      const created = await store.create({ email: 'test@test.com', name: 'Test' });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'GET',
        url: `/users/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(created.id);
    });

    it('should update entity through route', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const created = await store.create({ email: 'test@test.com', name: 'Original' });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'PUT',
        url: `/users/${created.id}`,
        payload: { email: 'test@test.com', name: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Updated');
    });

    it('should delete entity through route', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const created = await store.create({ email: 'test@test.com', name: 'To Delete' });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify deletion
      const found = await store.findById(created.id);
      expect(found).toBeNull();
    });

    it('should list entities through route', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      await store.create({ email: 'a@test.com', name: 'A' });
      await store.create({ email: 'b@test.com', name: 'B' });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/users',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
    });

    it('should handle store errors gracefully', async () => {
      // Create a store that throws on create
      const failingStore = Object.create(store);
      failingStore.create = async () => {
        throw new Error('Database connection failed');
      };

      const app = await createApp<{ store: MemoryStore<User> }>({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createAppContext: async () => ({ store: failingStore as any }),
      });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/users',
        payload: { email: 'test@test.com', name: 'Test' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('edge cases', () => {
    it('should handle malformed request body', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/users',
        payload: 'not-valid-json',
        headers: { 'content-type': 'application/json' },
      });

      // Fastify should handle invalid JSON
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('should handle empty store', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/users',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual([]);
    });

    it('should handle concurrent requests', async () => {
      const app = await createApp<{ store: MemoryStore<User> }>({
        createAppContext: async () => ({ store }),
      });

      const routes = generateCrudRoutes(UserModel, { store: app.context.store });
      for (const route of routes) {
        // RouteDefinition needs adapter for Fastify
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route({ ...route, url: route.path } as any);
      }

      // Create multiple requests simultaneously
      const promises = Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/users',
          payload: { email: `user${i}@test.com`, name: `User ${i}` },
        })
      );

      const responses = await Promise.all(promises);
      expect(responses.every(r => r.statusCode === 201)).toBe(true);

      // Verify all were stored
      const all = await store.findAll();
      expect(all.length).toBe(10);
    });
  });
});
