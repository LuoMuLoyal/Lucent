import { describe, expect, it } from 'vitest';

import { listMedicineCacheKeys } from './import-medicine-knowledge.ts';

describe('listMedicineCacheKeys', () => {
  it('scans the medicines prefix and returns the matching keys', async () => {
    const patterns: string[] = [];
    const client = {
      keys: async (pattern: string) => {
        patterns.push(pattern);
        return [
          'medicines:search:drugbank:ibuprofen:1:20',
          'medicines:detail:drugbank:DB01050',
        ];
      },
    };

    await expect(listMedicineCacheKeys(client)).resolves.toEqual([
      'medicines:search:drugbank:ibuprofen:1:20',
      'medicines:detail:drugbank:DB01050',
    ]);
    expect(patterns).toEqual(['medicines:*']);
  });

  it('drops anything the scan returned outside the medicines prefix', async () => {
    const client = {
      keys: async () => [
        'medicines:detail:cn:cn_ibuprofen_capsule',
        'auth:verification:test@example.com',
      ],
    };

    await expect(listMedicineCacheKeys(client)).resolves.toEqual([
      'medicines:detail:cn:cn_ibuprofen_capsule',
    ]);
  });

  it('deduplicates repeated keys', async () => {
    const client = {
      keys: async () => [
        'medicines:detail:cn:cn_ibuprofen_capsule',
        'medicines:detail:cn:cn_ibuprofen_capsule',
      ],
    };

    await expect(listMedicineCacheKeys(client)).resolves.toEqual([
      'medicines:detail:cn:cn_ibuprofen_capsule',
    ]);
  });

  it('handles the URL-encoded search key shape', async () => {
    const client = {
      keys: async () => [
        'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20',
      ],
    };

    await expect(listMedicineCacheKeys(client)).resolves.toEqual([
      'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20',
    ]);
  });
});
