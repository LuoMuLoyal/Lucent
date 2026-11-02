import {
  isReadMethod,
  isSafeCookieValue,
  pathnameOf,
  readBearerToken,
  readQueryString,
  resolveQueueMutation,
  stripQueryParam,
} from './queue-panel.utils.js';

describe('queue panel request utils', () => {
  describe('isReadMethod', () => {
    it('treats GET/HEAD/OPTIONS as read-only regardless of casing', () => {
      expect(isReadMethod('GET')).toBe(true);
      expect(isReadMethod('head')).toBe(true);
      expect(isReadMethod('Options')).toBe(true);
    });

    it('treats state-changing methods as writes', () => {
      expect(isReadMethod('POST')).toBe(false);
      expect(isReadMethod('put')).toBe(false);
      expect(isReadMethod('PATCH')).toBe(false);
      expect(isReadMethod('DELETE')).toBe(false);
    });
  });

  describe('readBearerToken', () => {
    it('extracts the token from a bearer header', () => {
      expect(readBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
      expect(readBearerToken('bearer  spaced ')).toBe('spaced');
    });

    it('returns null for missing or non-bearer schemes', () => {
      expect(readBearerToken(undefined)).toBeNull();
      expect(readBearerToken('Basic abc')).toBeNull();
      expect(readBearerToken('Bearer ')).toBeNull();
    });
  });

  describe('readQueryString', () => {
    it('reads a string parameter', () => {
      expect(readQueryString({ access_token: 'abc' }, 'access_token')).toBe(
        'abc',
      );
    });

    it('returns null for non-string, empty, or non-object queries', () => {
      expect(readQueryString({ access_token: '' }, 'access_token')).toBeNull();
      expect(readQueryString({ access_token: ['a'] }, 'access_token')).toBeNull();
      expect(readQueryString(undefined, 'access_token')).toBeNull();
      expect(readQueryString('nope', 'access_token')).toBeNull();
    });
  });

  describe('isSafeCookieValue', () => {
    it('accepts JWT-shaped values', () => {
      expect(isSafeCookieValue('eyJhbGciOiJIUzUxMiJ9.a-b_c.d')).toBe(true);
    });

    it('rejects values that could break the header', () => {
      expect(isSafeCookieValue('')).toBe(false);
      expect(isSafeCookieValue('a;b')).toBe(false);
      expect(isSafeCookieValue('a b')).toBe(false);
    });
  });

  describe('stripQueryParam', () => {
    it('removes the named parameter and keeps the rest', () => {
      expect(stripQueryParam('/admin/queues?access_token=t&page=2', 'access_token')).toBe(
        '/admin/queues?page=2',
      );
    });

    it('drops the query string entirely when it was the only parameter', () => {
      expect(stripQueryParam('/admin/queues?access_token=t', 'access_token')).toBe(
        '/admin/queues',
      );
    });
  });

  describe('pathnameOf', () => {
    it('drops the query string', () => {
      expect(pathnameOf('/admin/queues/api/queues?page=1')).toBe(
        '/admin/queues/api/queues',
      );
    });
  });

  describe('resolveQueueMutation', () => {
    it('names the queue and verb for a queue-scoped mutation', () => {
      expect(
        resolveQueueMutation(
          '/admin/queues/api/queues/lucent-cron/retry/waiting',
        ),
      ).toEqual({ queueName: 'lucent-cron', action: 'admin.queue.retry' });
    });

    it('reads the verb even when a job id precedes it', () => {
      expect(
        resolveQueueMutation('/admin/queues/api/queues/lucent-mail/42/clean'),
      ).toEqual({ queueName: 'lucent-mail', action: 'admin.queue.clean' });
    });

    it('reads the verb for job-scheduler routes', () => {
      expect(
        resolveQueueMutation(
          '/admin/queues/api/queues/lucent-cron/job-schedulers/sched-1/remove',
        ),
      ).toEqual({ queueName: 'lucent-cron', action: 'admin.queue.remove' });
    });

    it('marks global pause/resume as acting on every queue', () => {
      expect(resolveQueueMutation('/admin/queues/api/queues/pause')).toEqual({
        queueName: null,
        action: 'admin.queue.pauseAll',
      });
      expect(resolveQueueMutation('/admin/queues/api/queues/resume')).toEqual({
        queueName: null,
        action: 'admin.queue.resumeAll',
      });
    });

    it('falls back for unrecognised paths', () => {
      expect(resolveQueueMutation('/admin/queues/api/job-schedulers')).toEqual({
        queueName: null,
        action: 'admin.queue.mutation',
      });
      expect(
        resolveQueueMutation('/admin/queues/api/queues/not-a-queue/whatever'),
      ).toEqual({ queueName: null, action: 'admin.queue.mutation' });
    });
  });
});
