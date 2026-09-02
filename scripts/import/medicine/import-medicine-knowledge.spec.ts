import { describe, expect, it } from 'vitest';

import {
  listMedicineCacheKeys,
  stripNamespacePrefix,
} from './import-medicine-knowledge.ts';

describe('stripNamespacePrefix', () => {
  it('removes the expected prefix only once', () => {
    expect(
      stripNamespacePrefix('keyv:medicines:detail:drugbank:DB01050', 'keyv:'),
    ).toBe('medicines:detail:drugbank:DB01050');
    expect(
      stripNamespacePrefix('medicines:detail:drugbank:DB01050', 'keyv:'),
    ).toBe('medicines:detail:drugbank:DB01050');
  });
});

describe('listMedicineCacheKeys', () => {
  it('finds namespaced medicines keys and normalizes them', async () => {
    const patterns: string[] = [];
    const store = {
      keys: async (pattern: string) => {
        patterns.push(pattern);
        if (pattern === 'keyv:medicines:*') {
          return [
            'keyv:medicines:search:drugbank:ibuprofen:1:20',
            'keyv:medicines:detail:drugbank:DB01050',
            'keyv:auth:verification:test@example.com',
          ];
        }

        if (pattern === 'medicines:*') {
          return [];
        }

        return [];
      },
    };

    const keys = await listMedicineCacheKeys(store);

    expect(patterns).toEqual(['keyv:medicines:*', 'medicines:*']);
    expect(keys).toEqual([
      'medicines:search:drugbank:ibuprofen:1:20',
      'medicines:detail:drugbank:DB01050',
    ]);
  });

  it('deduplicates normalized keys across prefixed and raw scans', async () => {
    const store = {
      keys: async (pattern: string) => {
        if (pattern === 'keyv:medicines:*') {
          return ['keyv:medicines:detail:cn:cn_ibuprofen_capsule'];
        }

        if (pattern === 'medicines:*') {
          return ['medicines:detail:cn:cn_ibuprofen_capsule'];
        }

        return [];
      },
    };

    const keys = await listMedicineCacheKeys(store);

    expect(keys).toEqual(['medicines:detail:cn:cn_ibuprofen_capsule']);
  });

  it('supports stores without a namespace prefix', async () => {
    const store = {
      keys: async (pattern: string) => {
        if (pattern === 'medicines:*') {
          return ['medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20'];
        }

        return [];
      },
    };

    const keys = await listMedicineCacheKeys(store, undefined);

    expect(keys).toEqual([
      'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20',
    ]);
  });
});
