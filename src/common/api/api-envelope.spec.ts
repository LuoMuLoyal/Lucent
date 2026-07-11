import { ResultCode, successEnvelope, errorEnvelope } from './api-envelope';

describe('api-envelope', () => {
  describe('successEnvelope', () => {
    it('should return a success envelope with data', () => {
      const data = { id: 1, name: 'test' };
      const result = successEnvelope(data);

      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data,
      });
    });

    it('should handle null data', () => {
      const result = successEnvelope(null);

      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });

    it('should handle primitive data', () => {
      const result = successEnvelope('hello');

      expect(result.code).toBe(0);
      expect(result.data).toBe('hello');
    });

    it('should handle array data', () => {
      const data = [1, 2, 3];
      const result = successEnvelope(data);

      expect(result.data).toEqual([1, 2, 3]);
    });

    it('should handle undefined data', () => {
      const result = successEnvelope(undefined);

      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toBeUndefined();
    });

    it('should handle empty object data', () => {
      const result = successEnvelope({});

      expect(result.data).toEqual({});
    });

    it('should handle nested object data', () => {
      const data = { user: { name: 'test', age: 30 } };
      const result = successEnvelope(data);

      expect(result.data).toEqual(data);
    });

    it('should always set message to empty string', () => {
      const result = successEnvelope('data');
      expect(result.message).toBe('');
    });
  });

  describe('errorEnvelope', () => {
    it('should return an error envelope with code and message', () => {
      const result = errorEnvelope(ResultCode.BAD_REQUEST, 'Invalid input');

      expect(result).toEqual({
        code: ResultCode.BAD_REQUEST,
        message: 'Invalid input',
        data: null,
      });
    });

    it('should handle different error codes', () => {
      const result = errorEnvelope(ResultCode.UNAUTHORIZED, 'Not logged in');

      expect(result.code).toBe(ResultCode.UNAUTHORIZED);
      expect(result.message).toBe('Not logged in');
      expect(result.data).toBeNull();
    });

    it('should handle internal error', () => {
      const result = errorEnvelope(ResultCode.INTERNAL_ERROR, 'Server error');

      expect(result.code).toBe(500_001);
      expect(result.data).toBeNull();
    });

    it('should handle empty message', () => {
      const result = errorEnvelope(ResultCode.BAD_REQUEST, '');

      expect(result.code).toBe(ResultCode.BAD_REQUEST);
      expect(result.message).toBe('');
      expect(result.data).toBeNull();
    });

    it('should handle CONFLICT code', () => {
      const result = errorEnvelope(ResultCode.CONFLICT, 'duplicate');

      expect(result.code).toBe(409_001);
      expect(result.message).toBe('duplicate');
    });

    it('should handle TOKEN_EXPIRED code', () => {
      const result = errorEnvelope(ResultCode.TOKEN_EXPIRED, 'expired');

      expect(result.code).toBe(401_002);
    });
  });

  describe('ResultCode enum', () => {
    it('should have SUCCESS as 0', () => {
      expect(ResultCode.SUCCESS).toBe(0);
    });

    it('should have unique numeric codes for each error type', () => {
      const values = Object.values(ResultCode).filter(
        (v): v is number => typeof v === 'number',
      );
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });
  });
});
