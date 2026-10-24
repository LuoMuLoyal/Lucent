import type { E2eApp, E2eTestContext } from '../../helpers/e2e-helpers.js';
import { createTestApp } from '../../helpers/e2e-helpers.js';

/**
 * 图关系查询端点（`/api/v1/medicines/relations/*`）的 e2e。
 *
 * ## 这组用例测的是什么、不测什么
 *
 * 测的是**契约与降级语义**：路由挂上了、参数校验生效、返回信封的形状与三态、
 * 图不可达时不伪造空结果。
 *
 * **不测**图上的具体数据——那需要一台有真实图的 Neo4j，而 CI 没有，且图内容会随
 * 导入批次变化。写死「华法林应该返回 N 条」会让这个测试长期红着，然后被无视。
 * 图查询本身在模块单测 `infrastructure/graph/schema.spec.ts` 里验证 schema 可构建，
 * 真实数据验证在落地时人工做过（见 2026-10-24 迁移日志）。
 *
 * ## 三种 status 怎么造
 *
 * - `notConfigured`：test 环境没有 `NEO4J_URI`/`NEO4J_PASSWORD`，是默认状态；
 * - `unavailable` / `timeout`：把 URI 指向一个**必然连不上**的地址来造，
 *   比模拟 driver 更真实——它走的是和线上一样的连接失败路径。
 */

const BASE = '/api/v1/medicines/relations';

interface GraphEnvelope {
  status: 'ok' | 'notConfigured' | 'unavailable' | 'timeout';
  paths?: unknown[];
  targets?: unknown[];
  cascades?: unknown[];
  candidates?: unknown[];
  actions?: unknown[];
  routes?: unknown[];
  drugs?: unknown[];
  duels?: unknown[];
}

describe('Medicine relations graph API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 无需认证的公开读端点，直接取状态码与信封。 */
  async function get(
    path: string,
  ): Promise<{ status: number; body: GraphEnvelope }> {
    const response = await app.inject({ method: 'GET', url: `${BASE}${path}` });
    return {
      status: response.statusCode,
      body: response.json<GraphEnvelope>(),
    };
  }

  describe('配置缺失时的降级', () => {
    it('未配置图时返回 200 + notConfigured，而不是 5xx', async () => {
      // 关键语义：没配图是**已知状态**，不是服务端故障。返回 5xx 会触发
      // 客户端重试与告警，而这里重试永远不会成功。
      const { status, body } = await get('/actions?drugbankId=DB00682');

      expect(status).toBe(200);
      expect(body.status).toBe('notConfigured');
    });

    it('所有 9 个端点都不因未配置而抛错', async () => {
      // 逐个打一遍：任何一个端点漏了 status 处理都会表现为 500。
      const endpoints = [
        '/mechanism-paths?drugbankIds=DB00682,DB00004',
        '/shared-targets?drugbankIds=DB00682,DB00004',
        '/cascade-paths?drugbankId=DB00682',
        '/substitutes?drugbankId=DB00682&enzymeGene=CYP2C9',
        '/actions?drugbankId=DB00682',
        '/shortest-route?fromDrugbankId=DB00682&toDrugbankId=DB00004',
        '/target-drugs?geneName=CYP2C9',
        '/transport-routes?drugbankId=DB00682',
        '/enzyme-duel?drugbankIds=DB00682,DB00004',
      ];

      for (const endpoint of endpoints) {
        const { status, body } = await get(endpoint);
        expect(status, `endpoint ${endpoint}`).toBe(200);
        expect(body.status, `endpoint ${endpoint}`).toBe('notConfigured');
      }
    });

    it('失败时只给 status，不伪造空数组', async () => {
      // 这是整组端点最重要的约定：`ok` + 空数组 = 图上确实没有；
      // 其余 status = 我们无法回答。两者混同会让界面把知识缺口显示成「无风险」。
      const { body } = await get(
        '/mechanism-paths?drugbankIds=DB00682,DB00004',
      );

      expect(body.status).toBe('notConfigured');
      expect(body.paths).toBeUndefined();
    });
  });

  describe('入参校验', () => {
    it('缺少 drugbankId 时返回 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${BASE}/actions`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('drugbankId 形态不对时返回 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${BASE}/actions?drugbankId=aspirin`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('多药查询少于 2 个 id 时返回 400', async () => {
      // 一个药之间不存在「两两通路」，这是请求错误而不是空结果。
      const response = await app.inject({
        method: 'GET',
        url: `${BASE}/mechanism-paths?drugbankIds=DB00682`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('多药查询超过 10 个 id 时返回 400', async () => {
      // 上限存在的原因是笛卡尔积：INHIBITS × SUBSTRATE_OF 的组合数随药数平方增长。
      const ids = Array.from(
        { length: 11 },
        (_, i) => `DB${String(i + 1).padStart(5, '0')}`,
      );
      const response = await app.inject({
        method: 'GET',
        url: `${BASE}/mechanism-paths?drugbankIds=${ids.join(',')}`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('未知查询参数被拒绝（strict）', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${BASE}/actions?drugbankId=DB00682&cypher=MATCH(n)RETURN n`,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('安全边界', () => {
    it('没有接受 Cypher 的参数入口', async () => {
      // 把 Cypher 塞进任何一个已声明参数里，都必须被形态校验挡掉。
      const attempts = [
        `${BASE}/actions?drugbankId=MATCH%20(n)%20RETURN%20n`,
        `${BASE}/target-drugs?geneName=${encodeURIComponent('CYP2C9) //')}`,
        `${BASE}/substitutes?drugbankId=DB00682&enzymeGene=${encodeURIComponent('CYP2C9 MATCH')}`,
      ];

      for (const url of attempts) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(400);
      }
    });
  });

  describe('图不可达时的降级', () => {
    /**
     * 这组用**独立的应用实例**，因为连接参数在启动期读取。
     *
     * 与配置缺失的用例分开写：`notConfigured`（没配）和 `unavailable`（配了但
     * 连不上）是两种不同的运维状况，处置方式也不同——前者要配，后者要查网络。
     */
    let brokenCtx: E2eTestContext | undefined;

    beforeAll(async () => {
      process.env['NEO4J_URI'] = 'bolt://127.0.0.1:1';
      process.env['NEO4J_PASSWORD'] = 'definitely-wrong';
      brokenCtx = await createTestApp();
    });

    afterAll(async () => {
      delete process.env['NEO4J_URI'];
      delete process.env['NEO4J_PASSWORD'];
      await brokenCtx?.app.close();
    });

    it('连不上图时返回 unavailable，而不是抛错或空数组', async () => {
      const response = await brokenCtx!.app.inject({
        method: 'GET',
        url: `${BASE}/actions?drugbankId=DB00682`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<GraphEnvelope>();
      // 必须**真的走到了连接失败**，而不是悄悄退回 notConfigured——
      // 后者说明环境变量没被读到，这条用例就成了假通过。
      expect(body.status).not.toBe('notConfigured');
      expect(['unavailable', 'timeout']).toContain(body.status);
      expect(body.actions).toBeUndefined();
    });
  });
});
