/**
 * CRUD store implementations
 * Provides MemoryStore as default/example ICrud implementation
 */

import { ICrud } from '../types.js';

/**
 * In-memory store implementation of ICrud interface
 * For development, testing, and POC use cases
 */
export class MemoryStore<T extends { id: string }> implements ICrud<T> {
  private data = new Map<string, T>();

  async create(data: Omit<T, 'id'>): Promise<T> {
    const id = crypto.randomUUID();
    const entity = { ...data, id } as T;
    this.data.set(id, entity);
    return entity;
  }

  async findById(id: string): Promise<T | null> {
    return this.data.get(id) ?? null;
  }

  async findAll(opts?: { cursor?: string; limit?: number }): Promise<T[]> {
    let items = [...this.data.values()];

    // Apply cursor pagination if cursor provided
    if (opts?.cursor) {
      const cursorIndex = items.findIndex((item) => item.id === opts.cursor);
      if (cursorIndex !== -1) {
        items = items.slice(cursorIndex + 1);
      }
    }

    // Apply limit
    if (opts?.limit) {
      items = items.slice(0, opts.limit);
    }

    return items;
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    const existing = this.data.get(id);
    if (!existing) {
      throw new Error(`Not found: ${id}`);
    }
    const updated = { ...existing, ...data };
    this.data.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get count of items (useful for debugging)
   */
  size(): number {
    return this.data.size;
  }
}
