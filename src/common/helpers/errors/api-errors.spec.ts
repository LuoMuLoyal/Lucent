import {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  conflict,
} from './api-errors';

describe('api-errors', () => {
  describe('notFound', () => {
    it('throws NotFoundException with NOT_FOUND code', () => {
      expect(() => notFound('record not found')).toThrow(NotFoundException);
      try {
        notFound('record not found');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        const response = (e as NotFoundException).getResponse();
        expect(response).toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          message: 'record not found',
        });
      }
    });
  });

  describe('badRequest', () => {
    it('throws BadRequestException with BAD_REQUEST code', () => {
      expect(() => badRequest('invalid input')).toThrow(BadRequestException);
      try {
        badRequest('invalid input');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        const response = (e as BadRequestException).getResponse();
        expect(response).toMatchObject({
          code: 'VALIDATION_FAILED',
          message: 'invalid input',
        });
      }
    });
  });

  describe('unauthorized', () => {
    it('throws UnauthorizedException with UNAUTHORIZED code', () => {
      expect(() => unauthorized('not logged in')).toThrow(
        UnauthorizedException,
      );
      try {
        unauthorized('not logged in');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        const response = (e as UnauthorizedException).getResponse();
        expect(response).toMatchObject({
          code: 'AUTH_REQUIRED',
          message: 'not logged in',
        });
      }
    });
  });

  describe('forbidden', () => {
    it('throws ForbiddenException with FORBIDDEN code', () => {
      expect(() => forbidden('access denied')).toThrow(ForbiddenException);
      try {
        forbidden('access denied');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        const response = (e as ForbiddenException).getResponse();
        expect(response).toMatchObject({
          code: 'FORBIDDEN',
          message: 'access denied',
        });
      }
    });
  });

  describe('conflict', () => {
    it('throws ConflictException with CONFLICT code', () => {
      expect(() => conflict('duplicate entry')).toThrow(ConflictException);
      try {
        conflict('duplicate entry');
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictException);
        const response = (e as ConflictException).getResponse();
        expect(response).toMatchObject({
          code: 'RESOURCE_CONFLICT',
          message: 'duplicate entry',
        });
      }
    });
  });

  describe('edge cases', () => {
    it('notFound throws with empty message', () => {
      try {
        notFound('');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        const response = (e as NotFoundException).getResponse();
        expect(response).toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          message: '',
        });
      }
    });

    it('badRequest throws with empty message', () => {
      try {
        badRequest('');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        const response = (e as BadRequestException).getResponse();
        expect(response).toMatchObject({
          code: 'VALIDATION_FAILED',
          message: '',
        });
      }
    });

    it('unauthorized throws with empty message', () => {
      try {
        unauthorized('');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
        const response = (e as UnauthorizedException).getResponse();
        expect(response).toMatchObject({
          code: 'AUTH_REQUIRED',
          message: '',
        });
      }
    });

    it('forbidden throws with empty message', () => {
      try {
        forbidden('');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        const response = (e as ForbiddenException).getResponse();
        expect(response).toMatchObject({
          code: 'FORBIDDEN',
          message: '',
        });
      }
    });

    it('conflict throws with empty message', () => {
      try {
        conflict('');
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictException);
        const response = (e as ConflictException).getResponse();
        expect(response).toMatchObject({
          code: 'RESOURCE_CONFLICT',
          message: '',
        });
      }
    });

    it('all functions throw and never return', () => {
      expect(() => notFound('x')).toThrow();
      expect(() => badRequest('x')).toThrow();
      expect(() => unauthorized('x')).toThrow();
      expect(() => forbidden('x')).toThrow();
      expect(() => conflict('x')).toThrow();
    });
  });
});
