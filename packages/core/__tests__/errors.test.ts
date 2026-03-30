/**
 * Error Handling Tests
 * Tests condensed error format and FrameworkError behavior
 */
import { describe, it, expect } from 'vitest';
import { FrameworkError, ErrorCodes } from '../src/errors.js';

describe('FrameworkError', () => {
  describe('condensed error format', () => {
    it('should create error with c, s, r, t properties', () => {
      const error = new FrameworkError({
        code: 'E_INIT',
        c: 'E_INIT',
        s: 'dbService',
        r: 'conn_refus',
        t: Date.now(),
      });

      const json = error.toJSON();
      expect(json.c).toBe('E_INIT');
      expect(json.s).toBe('dbService');
      expect(json.r).toBe('conn_refus');
      expect(json.t).toBeDefined();
    });

    it('should truncate reason to 20 characters', () => {
      const error = new FrameworkError({
        code: 'E_INIT',
        c: 'E_INIT',
        s: 'service',
        r: 'This is a very long error message that should be truncated',
        t: 1234567890,
      });

      expect(error.reason.length).toBeLessThanOrEqual(20);
    });

    it('should auto-generate timestamp if not provided', () => {
      const before = Date.now();
      const error = new FrameworkError({
        code: 'E_NF',
      });
      const after = Date.now();

      expect(error.timestamp).toBeGreaterThanOrEqual(before);
      expect(error.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('error code standards', () => {
    it('should have E_INIT for initialization failures', () => {
      expect(ErrorCodes.E_INIT).toBe('E_INIT');
    });

    it('should have E_NF for not found', () => {
      expect(ErrorCodes.E_NF).toBe('E_NF');
    });

    it('should have E_VAL for validation errors', () => {
      expect(ErrorCodes.E_VAL).toBe('E_VAL');
    });

    it('should have E_DB for database errors', () => {
      expect(ErrorCodes.E_DB).toBe('E_DB');
    });

    it('should have E_AUTH for authentication errors', () => {
      expect(ErrorCodes.E_AUTH).toBe('E_AUTH');
    });
  });

  describe('backwards compatibility', () => {
    it('should support old error code aliases', () => {
      // Old codes map to new condensed format
      expect(ErrorCodes.VALIDATION_ERROR).toBe('E_VAL');
      expect(ErrorCodes.INIT_FAILURE).toBe('E_INIT');
    });
  });

  describe('static factory method', () => {
    it('should create error via FrameworkError.create', () => {
      const error = FrameworkError.create('E_DB', 'userService', 'timeout');

      expect(error.code).toBe('E_DB');
      expect(error.service).toBe('userService');
      expect(error.reason).toBe('timeout');
    });
  });

  describe('error serialization', () => {
    it('should serialize to JSON with toJSON', () => {
      const error = new FrameworkError({
        code: 'E_VAL',
        c: 'E_VAL',
        s: 'email',
        r: 'invalid_format',
        t: 1234567890,
      });

      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);

      expect(parsed.c).toBe('E_VAL');
      expect(parsed.s).toBe('email');
      expect(parsed.r).toBe('invalid_format');
      expect(parsed.t).toBe(1234567890);
    });
  });
});
