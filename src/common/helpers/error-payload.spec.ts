import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { httpExceptionPayload } from './error-payload';

describe('httpExceptionPayload', () => {
  // ── Non-HttpException inputs ────────────────────────────────────────────

  it('returns error.message for a plain Error', () => {
    const result = httpExceptionPayload(new Error('something broke'));
    expect(result).toEqual({ message: 'something broke' });
    expect(result.code).toBeUndefined();
    expect(result.statusCode).toBeUndefined();
  });

  it('returns generic message for non-Error throwables', () => {
    const result = httpExceptionPayload('just a string');
    expect(result).toEqual({ message: 'Unexpected error.' });
  });

  it('returns generic message for null', () => {
    const result = httpExceptionPayload(null);
    expect(result).toEqual({ message: 'Unexpected error.' });
  });

  it('returns generic message for undefined', () => {
    const result = httpExceptionPayload(undefined);
    expect(result).toEqual({ message: 'Unexpected error.' });
  });

  // ── HttpException with string response ──────────────────────────────────

  it('handles HttpException with a string response', () => {
    const exc = new HttpException('forbidden string', HttpStatus.FORBIDDEN);
    const result = httpExceptionPayload(exc);
    expect(result).toEqual({
      message: 'forbidden string',
      statusCode: HttpStatus.FORBIDDEN,
    });
    expect(result.code).toBeUndefined();
  });

  // ── HttpException with object response: string message ──────────────────

  it('handles HttpException with a string message in response object', () => {
    const exc = new BadRequestException('invalid input');
    const result = httpExceptionPayload(exc);
    expect(result.message).toBe('invalid input');
    expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  it('includes numeric code from response object when present', () => {
    const exc = new HttpException(
      { message: 'conflict', code: 409001 },
      HttpStatus.CONFLICT,
    );
    const result = httpExceptionPayload(exc);
    expect(result).toEqual({
      message: 'conflict',
      code: 409001,
      statusCode: HttpStatus.CONFLICT,
    });
  });

  it('ignores non-numeric code from response object', () => {
    const exc = new HttpException(
      { message: 'oops', code: 'not-a-number' },
      HttpStatus.BAD_REQUEST,
    );
    const result = httpExceptionPayload(exc);
    expect(result.code).toBeUndefined();
    expect(result.message).toBe('oops');
    expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── HttpException with array message ────────────────────────────────────

  it('joins array messages with "; "', () => {
    const exc = new BadRequestException([
      'fieldA must be a string',
      'fieldB must be positive',
    ]);
    const result = httpExceptionPayload(exc);
    expect(result.message).toBe(
      'fieldA must be a string; fieldB must be positive',
    );
    expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  it('joins array messages and includes numeric code', () => {
    const exc = new HttpException(
      { message: ['err1', 'err2'], code: 400002 },
      HttpStatus.BAD_REQUEST,
    );
    const result = httpExceptionPayload(exc);
    expect(result).toEqual({
      message: 'err1; err2',
      code: 400002,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  // ── HttpException with empty/whitespace message ─────────────────────────

  it('falls back to error.message when response message is an empty string', () => {
    const exc = new HttpException(
      { message: '   ', code: 500 },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    // The HttpException constructor stores the response object; error.message
    // is the default NestJS message.
    const result = httpExceptionPayload(exc);
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    // When message is blank, the code falls through to error.message
    expect(result.message).toBe(exc.message);
  });

  it('falls back to error.message when response has no message key', () => {
    const exc = new HttpException(
      { error: 'Some Error' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    const result = httpExceptionPayload(exc);
    // No "message" key in response → falls through to error.message
    expect(result.message).toBe(exc.message);
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  // ── HttpException with non-string, non-array message ────────────────────

  it('falls back to error.message when message is a non-string non-array type', () => {
    const exc = new HttpException({ message: 42 }, HttpStatus.BAD_REQUEST);
    const result = httpExceptionPayload(exc);
    expect(result.message).toBe(exc.message);
    expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── InternalServerErrorException ────────────────────────────────────────

  it('handles InternalServerErrorException', () => {
    const exc = new InternalServerErrorException('kaboom');
    const result = httpExceptionPayload(exc);
    expect(result.message).toBe('kaboom');
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  // ── Additional boundary cases ─────────────────────────────────────────

  it('joins empty array message to empty string', () => {
    const exc = new HttpException(
      { message: [], code: 400001 },
      HttpStatus.BAD_REQUEST,
    );
    const result = httpExceptionPayload(exc);
    // Empty array is joined → '' is returned directly (not falling back to error.message)
    expect(result.message).toBe('');
    expect(result.code).toBe(400001);
    expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  it('handles single-element array message', () => {
    const exc = new HttpException(
      { message: ['only one'], code: 400002 },
      HttpStatus.BAD_REQUEST,
    );
    const result = httpExceptionPayload(exc);
    expect(result.message).toBe('only one');
    expect(result.code).toBe(400002);
  });

  it('handles Error subclass with custom properties', () => {
    class CustomError extends Error {
      constructor(
        message: string,
        readonly code: number,
      ) {
        super(message);
        this.name = 'CustomError';
      }
    }
    const result = httpExceptionPayload(new CustomError('custom broke', 5001));
    expect(result.message).toBe('custom broke');
    expect(result.code).toBeUndefined(); // code from Error subclass is not extracted
  });

  it('handles HttpException with zero as numeric code', () => {
    const exc = new HttpException(
      { message: 'zero code', code: 0 },
      HttpStatus.BAD_REQUEST,
    );
    const result = httpExceptionPayload(exc);
    expect(result.code).toBe(0);
    expect(result.message).toBe('zero code');
  });
});
