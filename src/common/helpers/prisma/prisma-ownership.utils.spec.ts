import { ensureOwnedByUser } from './prisma-ownership.utils';
import { NotFoundException } from '@nestjs/common';
import { ResultCode } from '../../api/result-code';

describe('prisma-ownership.utils', () => {
  describe('ensureOwnedByUser', () => {
    it('does not throw when record belongs to user', () => {
      const record = { id: 'rec-1', userId: 'user-1', name: 'test' };
      expect(() => {
        ensureOwnedByUser(record, 'user-1', 'Not found');
      }).not.toThrow();
    });

    it('throws NotFoundException when record is null', () => {
      expect(() => {
        ensureOwnedByUser(null, 'user-1', 'Not found');
      }).toThrow(NotFoundException);
    });

    it('throws NotFoundException when record is undefined', () => {
      expect(() => {
        ensureOwnedByUser(undefined, 'user-1', 'Not found');
      }).toThrow(NotFoundException);
    });

    it('throws NotFoundException when record belongs to another user', () => {
      const record = { id: 'rec-1', userId: 'user-2', name: 'test' };
      expect(() => {
        ensureOwnedByUser(record, 'user-1', 'Not found');
      }).toThrow(NotFoundException);
    });

    it('throws NotFoundException with the exact provided message', () => {
      const record = { id: 'rec-1', userId: 'user-2', name: 'test' };
      try {
        ensureOwnedByUser(record, 'user-1', 'Custom not-found message');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
        const response = (e as NotFoundException).getResponse() as {
          code: number;
          message: string;
        };
        expect(response.message).toBe('Custom not-found message');
        expect(response.code).toBe(ResultCode.NOT_FOUND);
      }
    });

    it('throws when record.userId is empty string and user is different', () => {
      const record = { id: 'rec-1', userId: '', name: 'test' };
      expect(() => {
        ensureOwnedByUser(record, 'user-1', 'Not found');
      }).toThrow(NotFoundException);
    });

    it('does not throw when record.userId matches exactly', () => {
      const record = { id: 'rec-1', userId: 'user-1', name: 'test' };
      expect(() => {
        ensureOwnedByUser(record, 'user-1', 'Not found');
      }).not.toThrow();
    });
  });
});
