/**
 * KyselyStore — ICrud adapter for Kysely.
 *
 * The Kysely instance is typed as Kysely<any> internally so generic column
 * lookups (e.g. 'id') resolve without fighting Kysely's strict DB generics.
 * The public contract is enforced by T extends { id: string }.
 *
 * Requires a dialect that supports RETURNING (PostgreSQL, SQLite).
 * MySQL users should subclass and override create/update to issue a separate SELECT.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { Kysely } from 'kysely';
import type { ICrud } from '@klusterio/kinetic-core';

export class KyselyStore<T extends { id: string }>
  implements ICrud<T, Omit<T, 'id'>, Partial<T>>
{
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: Kysely<any>,
    private readonly table: string,
  ) {}

  async create(data: Omit<T, 'id'>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (this.db as any)
      .insertInto(this.table)
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as T;
  }

  async findById(id: string): Promise<T | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (this.db as any)
      .selectFrom(this.table)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return (result as T | undefined) ?? null;
  }

  async findAll(options?: { cursor?: string; limit?: number }): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.db as any).selectFrom(this.table).selectAll();

    // Cursor pagination: page forward past the last-seen id.
    if (options?.cursor) query = query.where('id', '>', options.cursor);
    if (options?.limit) query = query.limit(options.limit);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await query.execute()) as T[];
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (this.db as any)
      .updateTable(this.table)
      .set(data)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return result as T;
  }

  async delete(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.db as any)
      .deleteFrom(this.table)
      .where('id', '=', id)
      .execute();
  }
}
