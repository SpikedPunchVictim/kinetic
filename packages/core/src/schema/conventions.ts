/**
 * Conventions enforcement for naming, pagination, and responses
 */

import { FrameworkError, ErrorCodes } from '../errors.js';

// ============================================================================
// Response Types
// ============================================================================

export interface SuccessResponse<T> {
  data: T;
}

export interface ListResponse<T> {
  data: T[];
  pagination: {
    nextCursor?: string;
    hasMore: boolean;
    totalCount?: number;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    suggestion?: string;
    docsUrl?: string;
    field?: string;
  };
}

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationOptions {
  cursor?: string;
  limit?: number;
  sort?: string; // e.g., "-createdAt" for descending
}

export interface PaginationResult {
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Default pagination configuration
 */
export const PAGINATION_DEFAULTS = {
  limit: 20,
  maxLimit: 100,
} as const;

/**
 * Enforces cursor-based pagination on list data
 *
 * @param data - The full dataset (must be sorted)
 * @param options - Pagination options
 * @returns Paginated data with cursor info
 * @throws FrameworkError if pagination requirements not met
 */
export function enforcePagination<T>(
  data: T[],
  options: PaginationOptions = {}
): ListResponse<T> {
  const limit = Math.min(options.limit ?? PAGINATION_DEFAULTS.limit, PAGINATION_DEFAULTS.maxLimit);

  // Decode cursor if provided
  let startIndex = 0;
  if (options.cursor) {
    try {
      const decoded = Buffer.from(options.cursor, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (typeof parsed.index === 'number') {
        startIndex = parsed.index;
      }
    } catch {
      // Invalid cursor - start from beginning
      startIndex = 0;
    }
  }

  // Get page of data
  const endIndex = Math.min(startIndex + limit, data.length);
  const pageData = data.slice(startIndex, endIndex);

  // Generate next cursor
  const hasMore = endIndex < data.length;
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ index: endIndex })).toString('base64')
    : undefined;

  return {
    data: pageData,
    pagination: {
      nextCursor,
      hasMore,
      totalCount: data.length,
    },
  };
}

/**
 * Validates that pagination is being used on a list endpoint
 * @throws FrameworkError if pagination is missing
 */
export function validatePaginationRequired(endpoint: string): void {
  // This is called during route generation to enforce pagination
  // In a real implementation, this would check route configuration
  throw new FrameworkError({
    code: ErrorCodes.PAGINATION_REQUIRED,
    message: `List endpoint '${endpoint}' must use cursor-based pagination`,
    suggestion: 'Add pagination: true to the read options or set defaultPagination in framework config',
    docsUrl: '',
  });
}

// ============================================================================
// Response Wrapping
// ============================================================================

/**
 * Wraps a single item in standard response format
 */
export function wrapSuccess<T>(data: T): SuccessResponse<T> {
  return { data };
}

/**
 * Wraps a list in standard response format with pagination
 */
export function wrapList<T>(data: T[], pagination: PaginationResult): ListResponse<T> {
  return {
    data,
    pagination: {
      nextCursor: pagination.nextCursor,
      hasMore: pagination.hasMore,
    },
  };
}

/**
 * Wraps an error in standard response format
 */
export function wrapError(error: {
  code: string;
  message: string;
  suggestion?: string;
  docsUrl?: string;
  field?: string;
}): ErrorResponse {
  return { error };
}

// ============================================================================
// URL Conventions
// ============================================================================

/**
 * Converts PascalCase to kebab-case
 * - User -> user
 * - OrderItem -> order-item
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Simple pluralization
 */
export function pluralize(word: string): string {
  const irregulars: Record<string, string> = {
    child: 'children',
    person: 'people',
    man: 'men',
    woman: 'women',
    tooth: 'teeth',
    foot: 'feet',
    mouse: 'mice',
    goose: 'geese',
    ox: 'oxen',
    sheep: 'sheep',
    fish: 'fish',
    series: 'series',
    species: 'species',
  };

  if (irregulars[word]) {
    return irregulars[word];
  }

  if (word.endsWith('y') && !['a', 'e', 'i', 'o', 'u'].includes(word[word.length - 2])) {
    return word.slice(0, -1) + 'ies';
  }

  if (word.endsWith('s') || word.endsWith('sh') || word.endsWith('ch') ||
      word.endsWith('x') || word.endsWith('z')) {
    return word + 'es';
  }

  return word + 's';
}

/**
 * Generates a URL path from a model name
 * - User -> /users
 * - OrderItem -> /order-items
 */
export function generateUrlPath(modelName: string): string {
  const kebab = toKebabCase(modelName);
  const plural = pluralize(kebab);
  return `/${plural}`;
}

// ============================================================================
// Field Name Validation
// ============================================================================

/**
 * Validates field names follow camelCase
 * @throws FrameworkError if invalid
 */
export function validateFieldName(fieldName: string, context?: string): void {
  const camelCasePattern = /^[a-z][a-zA-Z0-9]*$/;

  if (!camelCasePattern.test(fieldName)) {
    const suggestion = fieldName.includes('_')
      ? `Use camelCase: '${snakeToCamel(fieldName)}'`
      : `Start with lowercase: '${fieldName.charAt(0).toLowerCase() + fieldName.slice(1)}'`;

    throw new FrameworkError({
      code: ErrorCodes.NAMING_VIOLATION,
      message: `Field '${fieldName}' ${context ? `in ${context} ` : ''}must follow camelCase convention`,
      suggestion,
      docsUrl: 'https://docs.kluster.io/errors/NAMING_VIOLATION',
      field: fieldName,
    });
  }
}

/**
 * Converts snake_case to camelCase
 */
function snakeToCamel(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// ============================================================================
// HTTP Status Codes
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * Gets the appropriate status code for CRUD operations
 */
export function getCrudStatusCode(operation: 'create' | 'read' | 'update' | 'delete'): number {
  switch (operation) {
    case 'create':
      return HTTP_STATUS.CREATED;
    case 'read':
    case 'update':
      return HTTP_STATUS.OK;
    case 'delete':
      return HTTP_STATUS.NO_CONTENT;
    default:
      return HTTP_STATUS.OK;
  }
}
