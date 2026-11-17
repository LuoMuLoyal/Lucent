import { describe, expect, it } from 'vitest';
import { Neo4jGraphQL } from '@neo4j/graphql';

import { MEDICINE_GRAPH_TYPE_DEFS } from './schema.js';
import { MEDICINE_GRAPH_QUERIES } from './executor.js';

/**
 * schema 的可构建性是整套图查询的前提：`@cypher` 里任何语法/指令错误都会让
 * **服务启动时构建 schema 失败**，而那时错误信息只指向 SDL 行号，排查成本很高。
 * 这些用例在 CI 里先把它钉住，不依赖 Neo4j 是否可达。
 */
describe('medicine graph schema', () => {
  it('builds a valid OGM schema', async () => {
    const ogm = new Neo4jGraphQL({ typeDefs: MEDICINE_GRAPH_TYPE_DEFS });
    await expect(ogm.getSchema()).resolves.toBeDefined();
  });

  it('exposes every declared query', async () => {
    const ogm = new Neo4jGraphQL({ typeDefs: MEDICINE_GRAPH_TYPE_DEFS });
    const schema = await ogm.getSchema();
    const fields = Object.keys(schema.getQueryType()?.getFields() ?? {});

    for (const query of MEDICINE_GRAPH_QUERIES) {
      expect(fields).toContain(query);
    }
  });

  it('does not expose a free-form cypher field', async () => {
    // 安全边界：schema 里不能有「传 Cypher 进来执行」的入口。
    // 若将来有人加了这类字段，这条用例必须失败——否则任意查询面就暴露了。
    const ogm = new Neo4jGraphQL({ typeDefs: MEDICINE_GRAPH_TYPE_DEFS });
    const schema = await ogm.getSchema();
    const fields = Object.keys(schema.getQueryType()?.getFields() ?? {}).map(
      (name) => name.toLowerCase(),
    );

    expect(fields).not.toContain('cypher');
    expect(fields).not.toContain('runcypher');
    expect(fields).not.toContain('rawquery');
  });
});
