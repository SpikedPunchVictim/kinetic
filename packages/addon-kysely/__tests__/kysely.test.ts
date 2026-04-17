import { describe, it, expect, beforeEach } from 'vitest';
import { KyselyStore } from '../src/index.js';

// ---------------------------------------------------------------------------
// Minimal Kysely mock
// Mirrors the fluent chain that KyselyStore actually calls so we can test
// store logic without a real database.
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown> & { id: string };

class MockDb {
  private tables = new Map<string, MockRow[]>();

  seed(table: string, rows: MockRow[] = []): void {
    this.tables.set(table, [...rows]);
  }

  rows(table: string): MockRow[] {
    return this.tables.get(table) ?? [];
  }

  insertInto(table: string) {
    const rows = this.tables.get(table)!;
    return {
      values: (data: object) => ({
        returningAll: () => ({
          executeTakeFirstOrThrow: async () => {
            const row = { ...data, id: crypto.randomUUID() } as MockRow;
            rows.push(row);
            return row;
          },
        }),
      }),
    };
  }

  selectFrom(table: string) {
    const source = this.tables.get(table)!;
    // Mutable state for the builder chain.
    let filtered = [...source];

    const builder = {
      selectAll: () => builder,
      where: (col: string, op: string, val: unknown) => {
        if (op === '=') filtered = filtered.filter(r => r[col] === val);
        if (op === '>') filtered = filtered.filter(r => String(r[col]) > String(val));
        return builder;
      },
      limit: (n: number) => {
        filtered = filtered.slice(0, n);
        return builder;
      },
      execute: async () => [...filtered],
      executeTakeFirst: async () => filtered[0] as MockRow | undefined,
    };
    return builder;
  }

  updateTable(table: string) {
    const rows = this.tables.get(table)!;
    return {
      set: (data: object) => ({
        where: (col: string, _op: string, val: unknown) => ({
          returningAll: () => ({
            executeTakeFirstOrThrow: async () => {
              const idx = rows.findIndex(r => r[col] === val);
              if (idx === -1) throw new Error(`Row not found: ${col}=${val}`);
              rows[idx] = { ...rows[idx], ...data } as MockRow;
              return rows[idx];
            },
          }),
        }),
      }),
    };
  }

  deleteFrom(table: string) {
    const rows = this.tables.get(table)!;
    return {
      where: (col: string, _op: string, val: unknown) => ({
        execute: async () => {
          const idx = rows.findIndex(r => r[col] === val);
          if (idx !== -1) rows.splice(idx, 1);
          return [];
        },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type User = { id: string; name: string; email: string };

let db: MockDb;
let store: KyselyStore<User>;

beforeEach(() => {
  db = new MockDb();
  db.seed('users');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store = new KyselyStore<User>(db as any, 'users');
});

describe('KyselyStore', () => {
  describe('create()', () => {
    it('inserts a row and returns it with a generated id', async () => {
      const user = await store.create({ name: 'Alice', email: 'alice@example.com' });

      expect(user.id).toBeDefined();
      expect(user.name).toBe('Alice');
      expect(user.email).toBe('alice@example.com');
    });

    it('persists the row so subsequent findAll returns it', async () => {
      await store.create({ name: 'Alice', email: 'alice@example.com' });
      const all = await store.findAll();
      expect(all).toHaveLength(1);
    });
  });

  describe('findById()', () => {
    it('returns the matching row', async () => {
      const created = await store.create({ name: 'Alice', email: 'alice@example.com' });
      const found = await store.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Alice');
    });

    it('returns null for unknown id', async () => {
      const found = await store.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findAll()', () => {
    beforeEach(async () => {
      await store.create({ name: 'Alice', email: 'alice@example.com' });
      await store.create({ name: 'Bob', email: 'bob@example.com' });
      await store.create({ name: 'Carol', email: 'carol@example.com' });
    });

    it('returns all rows when called with no options', async () => {
      const results = await store.findAll();
      expect(results).toHaveLength(3);
    });

    it('respects limit', async () => {
      const results = await store.findAll({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('applies cursor to page forward', async () => {
      const all = await store.findAll();
      const cursor = all[0].id;

      const paged = await store.findAll({ cursor });
      // Should return rows whose id is lexicographically > cursor
      expect(paged.every(r => r.id > cursor)).toBe(true);
    });
  });

  describe('update()', () => {
    it('updates fields and returns the updated row', async () => {
      const user = await store.create({ name: 'Alice', email: 'alice@example.com' });
      const updated = await store.update(user.id, { name: 'Alicia' });

      expect(updated.id).toBe(user.id);
      expect(updated.name).toBe('Alicia');
      expect(updated.email).toBe('alice@example.com');
    });

    it('throws when the row does not exist', async () => {
      await expect(
        store.update('00000000-0000-0000-0000-000000000000', { name: 'Ghost' })
      ).rejects.toThrow();
    });
  });

  describe('delete()', () => {
    it('removes the row from the store', async () => {
      const user = await store.create({ name: 'Alice', email: 'alice@example.com' });
      await store.delete(user.id);

      const found = await store.findById(user.id);
      expect(found).toBeNull();
    });

    it('resolves without error for an unknown id', async () => {
      await expect(
        store.delete('00000000-0000-0000-0000-000000000000')
      ).resolves.not.toThrow();
    });
  });
});
