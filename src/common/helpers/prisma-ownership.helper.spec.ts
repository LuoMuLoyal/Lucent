import { ensureOwnedByUser } from './prisma-ownership.helper';
import { NotFoundException } from '@nestjs/common';

describe('prisma-ownership.helper', () => {
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

    it('throws with the provided message', () => {
      const record = { id: 'rec-1', userId: 'user-2', name: 'test' };
      try {
        ensureOwnedByUser(record, 'user-1', 'Record not owned by user');
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(NotFoundException);
      }
    });
  });
});
