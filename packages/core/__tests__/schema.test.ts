import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineModel } from '../src/schema/model.js';
import { generateCrudRoutes } from '../src/schema/routes.js';
import { wrapSuccess, wrapList, toKebabCase, pluralize, generateUrlPath, HTTP_STATUS } from '../src/schema/conventions.js';
import { MemoryStore } from '../src/crud/store.js';
import type { Model } from '../src/types.js';

const TestUserModel: Model = defineModel({
  name: 'User',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string(),
    createdAt: z.date(),
  },
});

describe('Schema Module', () => {
  describe('Model Definition', () => {
    it('should create model with valid fields', () => {
      const UserModel = defineModel({
        name: 'User',
        fields: {
          id: z.string().uuid(),
          email: z.string().email(),
          firstName: z.string(),
          createdAt: z.date(),
        },
      });

      expect(UserModel.name).toBe('User');
      expect(UserModel.getFields()).toHaveLength(4);
    });

    // ADR-002: Naming enforcement removed
    it('should allow any valid field names including snake_case', () => {
      expect(() => {
        defineModel({
          name: 'User',
          fields: {
            first_name: z.string(),
            user_id: z.string(),
          },
        });
      }).not.toThrow();
    });

    it('should expose input schema (without id, timestamps)', () => {
      const UserModel = defineModel({
        name: 'User',
        fields: {
          id: z.string().uuid(),
          email: z.string().email(),
          firstName: z.string(),
          createdAt: z.date(),
        },
      });

      const inputShape = UserModel.inputSchema.shape;
      expect(Object.keys(inputShape)).not.toContain('id');
      expect(Object.keys(inputShape)).not.toContain('createdAt');
      expect(Object.keys(inputShape)).toContain('email');
      expect(Object.keys(inputShape)).toContain('firstName');
    });

    it('should expose output schema (all fields)', () => {
      const UserModel = defineModel({
        name: 'User',
        fields: {
          id: z.string(),
          email: z.string(),
        },
      });

      const outputShape = UserModel.outputSchema.shape;
      expect(Object.keys(outputShape)).toContain('id');
      expect(Object.keys(outputShape)).toContain('email');
    });

    it('should provide field metadata', () => {
      const UserModel = defineModel({
        name: 'User',
        fields: {
          id: z.string(),
          email: z.string().email(),
          age: z.number().optional(),
        },
      });

      const fields = UserModel.getFields();
      const emailField = fields.find(f => f.name === 'email');
      expect(emailField).toBeDefined();
      expect(emailField?.required).toBe(true);

      const ageField = fields.find(f => f.name === 'age');
      expect(ageField?.required).toBe(false);
    });
  });

  describe('CRUD Route Generation', () => {
    it('should generate routes for a model', () => {
      const routes = generateCrudRoutes(TestUserModel, { store: new MemoryStore() });
      expect(routes).toHaveLength(5);
    });

    it('should generate routes with correct paths', () => {
      const routes = generateCrudRoutes(TestUserModel, { store: new MemoryStore() });
      const paths = routes.map(r => r.path);
      expect(paths).toContain('/users');
      expect(paths).toContain('/users/:id');
    });
  });

  describe('URL Generation', () => {
    it('should pluralize simple model names', () => {
      expect(generateUrlPath('User')).toBe('/users');
    });

    it('should convert compound names to kebab-case', () => {
      expect(generateUrlPath('OrderItem')).toBe('/order-items');
    });
  });

  describe('Conventions', () => {
    it('should pluralize words', () => {
      expect(pluralize('user')).toBe('users');
      expect(pluralize('category')).toBe('categories');
    });

    it('should convert to kebab-case', () => {
      expect(toKebabCase('UserProfile')).toBe('user-profile');
    });

    it('should wrap success response', () => {
      const data = { id: '1', name: 'Test' };
      const result = wrapSuccess(data);
      expect(result.data).toEqual(data);
    });

    it('should wrap list response with pagination', () => {
      const data = [{ id: '1' }];
      const result = wrapList(data, { nextCursor: undefined, hasMore: false });
      expect(result.data).toEqual(data);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should have correct HTTP status codes', () => {
      expect(HTTP_STATUS.CREATED).toBe(201);
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.NO_CONTENT).toBe(204);
    });
  });
});
