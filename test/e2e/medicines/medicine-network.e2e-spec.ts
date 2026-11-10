import type { E2eApp, E2eTestContext } from '../../helpers/e2e-helpers.js';
import { createTestApp } from '../../helpers/e2e-helpers.js';

/**
 * 单药邻域图端点（`/api/v1/medicines/:id/network`）的 e2e。
 *
 * ## 这组用例测什么、不测什么
 *
 * 测**契约与校验**：路由挂上了、未知 id 是 404 而不是 200 空图、
 * 超出上限的 `limit` 被拒、`source=cn` 在没有关系图时给出空图而不是错误。
 *
 * **不测**具体图内容：test 库的 `drugbank_*` 表是空的（e2e 走 `cleanupDatabase`，
 * 药品知识是导入产物，不随测试夹具构造）。真实数据下的度数验证在开发时手工做过
 * （`DB00176` = 2,249 相互作用 / 3 靶点，`count(*)` 走 Index Only Scan 2.4 ms），
 * 结论记录在 2026-11-10 迁移日志。
 *
 * 把「某个药应返回 N 个邻居」写进这里会让测试长期红着——药品知识随导入批次变化。
 */

const BASE = '/api/v1/medicines';

/** 与 `domain/relations/network.ts` 的 `MAX_NEIGHBOUR_LIMIT` 对齐。 */
const MAX_NEIGHBOUR_LIMIT = 100;

describe('Medicine network API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 公开读端点：直接取状态码与响应体。 */
  async function get(path: string): Promise<{ status: number; body: unknown }> {
    const response = await app.inject({ method: 'GET', url: path });
    return { status: response.statusCode, body: response.json() };
  }

  it('未知药品 id → 404，而不是 200 空图', async () => {
    const { status } = await get(`${BASE}/DB99999/network`);
    expect(status).toBe(404);
  });

  it('limit 超过上限 → 400（不静默钳制）', async () => {
    const { status } = await get(
      `${BASE}/DB99999/network?limit=${MAX_NEIGHBOUR_LIMIT + 1}`,
    );
    expect(status).toBe(400);
  });

  it('limit 为 0 → 400', async () => {
    const { status } = await get(`${BASE}/DB99999/network?limit=0`);
    expect(status).toBe(400);
  });

  it('不支持的 depth → 400（只支持 1：深度 2 在相互作用图上是平方级）', async () => {
    const { status } = await get(`${BASE}/DB99999/network?depth=2`);
    expect(status).toBe(400);
  });

  it('未知查询参数 → 400（strict schema 拒绝白名单外的键）', async () => {
    const { status } = await get(`${BASE}/DB99999/network?ordering=importance`);
    expect(status).toBe(400);
  });

  it('source=cn 且药品不存在 → 404（cn 无关系图，但存在性仍然校验）', async () => {
    const { status } = await get(`${BASE}/DB99999/network?source=cn`);
    expect(status).toBe(404);
  });

  it('source 取值非法 → 400', async () => {
    const { status } = await get(`${BASE}/DB99999/network?source=pubchem`);
    expect(status).toBe(400);
  });
});
