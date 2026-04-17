/**
 * defineService — wraps an ICrud store with optional lifecycle hooks.
 * Reduces per-entity boilerplate while keeping the factory pattern (ADR-002).
 */

import type { ICrud } from './types.js';

export interface ServiceHooks<T, CreateInput, UpdateInput> {
  beforeCreate?: (data: CreateInput) => Promise<CreateInput> | CreateInput;
  afterCreate?: (entity: T) => Promise<T> | T;
  beforeUpdate?: (id: string, data: UpdateInput) => Promise<UpdateInput> | UpdateInput;
  afterUpdate?: (entity: T) => Promise<T> | T;
  beforeDelete?: (id: string) => Promise<void> | void;
}

export function defineService<
  T extends { id: string },
  CreateInput = Omit<T, 'id'>,
  UpdateInput = Partial<T>,
>(config: {
  store: ICrud<T, CreateInput, UpdateInput>;
  hooks?: ServiceHooks<T, CreateInput, UpdateInput>;
}): ICrud<T, CreateInput, UpdateInput> {
  const { store, hooks = {} } = config;

  return {
    async create(data) {
      const input = hooks.beforeCreate ? await hooks.beforeCreate(data) : data;
      const entity = await store.create(input);
      return hooks.afterCreate ? hooks.afterCreate(entity) : entity;
    },

    findById(id) {
      return store.findById(id);
    },

    findAll(options) {
      return store.findAll(options);
    },

    async update(id, data) {
      const input = hooks.beforeUpdate ? await hooks.beforeUpdate(id, data) : data;
      const entity = await store.update(id, input);
      return hooks.afterUpdate ? hooks.afterUpdate(entity) : entity;
    },

    async delete(id) {
      if (hooks.beforeDelete) await hooks.beforeDelete(id);
      return store.delete(id);
    },
  };
}
