/**
 * Schema submodule exports
 * Model definitions, CRUD routes, and convention enforcement
 */

// Model exports
export {
  defineModel,
  type Model,
  type ModelDefinition,
  type RelationDefinition,
  type FieldInfo,
  type RelationInfo,
} from './model.js';

// Re-export generateUrlPath from conventions as single source of truth
export { generateUrlPath } from './conventions.js';

// Conventions exports
export {
  enforcePagination,
  wrapSuccess,
  wrapList,
  wrapError,
  toKebabCase,
  pluralize,
  getCrudStatusCode,
  HTTP_STATUS,
  type SuccessResponse,
  type ListResponse,
  type ErrorResponse,
  type PaginationOptions,
  type PaginationResult,
} from './conventions.js';

// Routes exports
export { generateCrudRoutes } from './routes.js';
// Types exported from types.ts, not routes.js
export type {
  HttpMethod,
  RouteHandler,
  Middleware,
  RouteDefinition,
  Request,
  Reply,
} from '../types.js';
