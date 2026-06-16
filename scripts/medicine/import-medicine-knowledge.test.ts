const assert = require('node:assert/strict');
const test = require('node:test');

const {
  listMedicineCacheKeys,
  stripNamespacePrefix,
} = require('./import-medicine-knowledge.ts');

test('stripNamespacePrefix removes the expected prefix only once', () => {
  assert.equal(
    stripNamespacePrefix('keyv:medicines:detail:drugbank:DB01050', 'keyv:'),
    'medicines:detail:drugbank:DB01050',
  );
  assert.equal(
    stripNamespacePrefix('medicines:detail:drugbank:DB01050', 'keyv:'),
    'medicines:detail:drugbank:DB01050',
  );
});

test('listMedicineCacheKeys finds namespaced medicines keys and normalizes them', async () => {
  const patterns = [];
  const store = {
    keys: async (pattern) => {
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

  assert.deepEqual(patterns, ['keyv:medicines:*', 'medicines:*']);
  assert.deepEqual(keys, [
    'medicines:search:drugbank:ibuprofen:1:20',
    'medicines:detail:drugbank:DB01050',
  ]);
});

test('listMedicineCacheKeys deduplicates normalized keys across prefixed and raw scans', async () => {
  const store = {
    keys: async (pattern) => {
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

  assert.deepEqual(keys, ['medicines:detail:cn:cn_ibuprofen_capsule']);
});

test('listMedicineCacheKeys supports stores without a namespace prefix', async () => {
  const store = {
    keys: async (pattern) => {
      if (pattern === 'medicines:*') {
        return ['medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20'];
      }

      return [];
    },
  };

  const keys = await listMedicineCacheKeys(store, undefined);

  assert.deepEqual(keys, [
    'medicines:search:cn:%E5%B8%83%E6%B4%9B%E8%8A%AC:1:20',
  ]);
});
