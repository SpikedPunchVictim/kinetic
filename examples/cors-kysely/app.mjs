/**
 * CORS + Kysely Example
 * Demonstrates: CorsAddon, KyselyStore, defineService, defineMiddleware
 *
 * Uses an in-memory SQLite database via Kysely so the example runs without
 * a real database server. Swap to PostgresDialect for production.
 */

import { createApp, defineService, defineMiddleware, FrameworkError, ErrorCodes } from '@klusterio/kinetic-core';
import { wrapSuccess, enforcePagination } from '@klusterio/kinetic-core/schema';
import { CorsAddon } from '@klusterio/addon-cors';
import { KyselyStore } from '@klusterio/addon-kysely';
import { Kysely } from 'kysely';

// ---------------------------------------------------------------------------
// NOTE: This example uses a JavaScript mock db to stay dependency-free.
// In production replace with:
//   import { PostgresDialect } from 'kysely';
//   const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory implementation that satisfies the Kysely query builder
 * interface used by KyselyStore. For demonstration only.
 */
function createMockDb() {
  const tables = new Map();

  const getTable = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  return {
    insertInto: (table) => {
      const rows = getTable(table);
      return {
        values: (data) => ({
          returningAll: () => ({
            executeTakeFirstOrThrow: async () => {
              const row = { ...data, id: crypto.randomUUID() };
              rows.push(row);
              return row;
            },
          }),
        }),
      };
    },
    selectFrom: (table) => {
      const source = getTable(table);
      let filtered = [...source];
      const builder = {
        selectAll: () => builder,
        where: (col, op, val) => {
          if (op === '=') filtered = filtered.filter(r => r[col] === val);
          if (op === '>') filtered = filtered.filter(r => String(r[col]) > String(val));
          return builder;
        },
        limit: (n) => { filtered = filtered.slice(0, n); return builder; },
        execute: async () => [...filtered],
        executeTakeFirst: async () => filtered[0] ?? undefined,
      };
      return builder;
    },
    updateTable: (table) => {
      const rows = getTable(table);
      return {
        set: (data) => ({
          where: (col, _op, val) => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: async () => {
                const idx = rows.findIndex(r => r[col] === val);
                if (idx === -1) throw new Error(`Not found: ${col}=${val}`);
                rows[idx] = { ...rows[idx], ...data };
                return rows[idx];
              },
            }),
          }),
        }),
      };
    },
    deleteFrom: (table) => {
      const rows = getTable(table);
      return {
        where: (col, _op, val) => ({
          execute: async () => {
            const idx = rows.findIndex(r => r[col] === val);
            if (idx !== -1) rows.splice(idx, 1);
            return [];
          },
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------

const app = await createApp({
  createAppContext: async () => {
    const db = createMockDb();

    // KyselyStore wires the mock db to ICrud — swap db for a real Kysely
    // instance in production without changing any service or route code.
    const userService = defineService({
      store: new KyselyStore(db, 'users'),
    });

    const productService = defineService({
      store: new KyselyStore(db, 'products'),
      hooks: {
        beforeCreate: async (data) => ({
          ...data,
          createdAt: new Date().toISOString(),
        }),
      },
    });

    return { userService, productService };
  },
  fastifyOptions: { logger: true },
});

// ---------------------------------------------------------------------------
// CORS — allow all origins for this demo API
// ---------------------------------------------------------------------------

await app.register(CorsAddon.plugin({
  origin: '*',
  exposedHeaders: ['x-request-id'],
}));

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const requireJson = defineMiddleware('requireJson', async (req, reply) => {
  if (req.method !== 'GET' && !req.headers['content-type']?.includes('application/json')) {
    reply.code(415).send({ error: 'Content-Type must be application/json' });
  }
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const { userService, productService } = app.context;

app.get('/health', async (req) => ({
  status: 'healthy',
  requestId: req.id,
  timestamp: new Date().toISOString(),
}));

// Users
app.post('/users', { preHandler: [requireJson.fn] }, async (req) => {
  const user = await userService.create(req.body);
  return wrapSuccess(user);
});

app.get('/users', async (req) => {
  const users = await userService.findAll();
  const { cursor, limit } = req.query || {};
  return enforcePagination(users, { cursor, limit: limit ? parseInt(limit) : 10 });
});

app.get('/users/:id', async (req) => {
  const user = await userService.findById(req.params.id);
  if (!user) throw new FrameworkError({ code: ErrorCodes.E_NF, c: 'E_NF', s: 'userService', r: 'not_found', t: Date.now() });
  return wrapSuccess(user);
});

app.delete('/users/:id', async (req, reply) => {
  await userService.delete(req.params.id);
  reply.status(204);
  return null;
});

// Products
app.post('/products', { preHandler: [requireJson.fn] }, async (req) => {
  const product = await productService.create(req.body);
  return wrapSuccess(product);
});

app.get('/products', async (req) => {
  const products = await productService.findAll();
  const { cursor, limit } = req.query || {};
  return enforcePagination(products, { cursor, limit: limit ? parseInt(limit) : 20 });
});

app.get('/products/:id', async (req) => {
  const product = await productService.findById(req.params.id);
  if (!product) throw new FrameworkError({ code: ErrorCodes.E_NF, c: 'E_NF', s: 'productService', r: 'not_found', t: Date.now() });
  return wrapSuccess(product);
});

// ---------------------------------------------------------------------------
// Seed & start
// ---------------------------------------------------------------------------

await userService.create({ name: 'Alice', email: 'alice@example.com' });
await userService.create({ name: 'Bob', email: 'bob@example.com' });
await productService.create({ name: 'Widget', price: 9.99, sku: 'WGT-001' });
await productService.create({ name: 'Gadget', price: 29.99, sku: 'GDG-001' });

await app.listen({ port: 3001, host: '127.0.0.1' });

console.log('\n✅ CORS + Kysely example running on http://127.0.0.1:3001');
console.log('   Try: curl -H "Origin: https://example.com" http://127.0.0.1:3001/users');

export { app };
