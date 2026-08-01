# LangGraph Checkpoint 持久化 + 图内审批（HITL）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 Postgres-backed LangGraph checkpoint 做会话（thread）持久化，并把"写入提案审批"从客户端确认模式升级为图内 `interrupt`（human-in-the-loop），保留客户端写路径。

**Architecture:** 以现有 `DATABASE_URL`（`pg` Pool）接入 `PostgresSaver` 作为 `compile({ checkpointer })` 的检查点存储，`thread_id = conversationId`；write 分支在主图插入两段式节点（`write_review_setup` 记录 pending 状态 → `write_review` 执行 `interrupt` 挂起线程）；新增独立确认端点通过 `Command({ resume })` 恢复线程，真实写入仍由客户端调现有 CRUD 完成。

**Tech Stack:** NestJS · `@langchain/langgraph@1.4.2`（`interrupt`/`Command`/`StateGraph`）· `@langchain/langgraph-checkpoint-postgres` · `pg@^8.21.0` · Prisma（`DATABASE_URL`）· vitest

---

## 背景与现状

- 图是无状态单轮执行器：`runConversation` 每次 `graph.invoke(input)`，无 checkpointer、无 `thread_id`。
- 审批是"提案 → 客户端确认"模式：4 个 `propose_*` 工具只产 `AssistantProposedAction`（`status:'proposed'`、`confirmationRequired:true`、`expiresAt`），图跑完返回提案，**用户在客户端确认后由客户端调真实写接口**，图不参与确认过程。
- 会话有现成 `conversationId`（`POST assistant/conversations/:conversationId/open` 创建/激活），但 `messages/stream` 请求未携带它。
- 数据库基建：Prisma + `DATABASE_URL`，`pg@^8.21.0` 已是直接依赖；`src/modules/assistant/tools/vector/vector-store.factory.ts` 已有用 `DATABASE_URL` 建 `pg.Pool` 的先例。
- 已确认 API（本地 `@langchain/langgraph@1.4.2` 类型）：`interrupt`、`Command`、`BaseCheckpointSaver` 均可从 `@langchain/langgraph` 导入；`compile({ checkpointer, cache })` 支持。

## 已确认决策（用户）

1. **写入执行方 = 客户端保留写路径**：图内 interrupt 只做审批闸门（确认状态记录 + 恢复线程生成回复），真实写入仍由客户端在确认后调用现有 CRUD。
2. **确认接口 = 独立端点**：`POST assistant/conversations/:conversationId/confirm`，携带 `proposalIds + decision + note`。

## 设计要点

### 1. Checkpoint 层（`AssistantCheckpointerService`）

- 封装 `PostgresSaver`：用 `DATABASE_URL` 建 `pg.Pool`（复用 vector-store 模式），`new PostgresSaver({ pool })` + `await saver.setup()`（幂等建表，版本不同可能还需 `migrate()`，装包后按类型定义验证）。
- **module 级单例**，跨请求共享；`onModuleDestroy` 释放 pool。
- **降级**：`DATABASE_URL` 缺失或初始化失败 → `getSaver()` 返回 `null`，图走旧行为（不 interrupt、不传 thread_id），不把 assistant 打挂。
- 测试环境不连真实 DB：spec 中 mock 该 service；graph 行为测试用 `new MemorySaver()`。

### 2. thread 映射与会话持久化

- `thread_id = conversationId`。
- `runConversation` input 与 `StreamAssistantMessagesDto` 增加**可选** `conversationId`（向后兼容：缺省时维持现状，不传 thread_id、不 interrupt）。
- 图内 `messages` 仍以客户端窗口为输入（现状兼容，不引入双源历史），checkpoint 承担**中断状态持久化**；多轮历史仍由 `conversation.service` 持久化（避免重复建设）。

### 3. 图内审批（两段式节点，interrupt 放主图）

write 分支新结构（仅当 checkpointer 可用时启用）：

```
classify_intent: write_proposal
  → write_subgraph（产出提案/校验，原有逻辑不变）
  → write_review_setup（提取 proposalIds/expiresAt，写 pendingReview，stopReason='awaiting_review'）
  → write_review（interrupt 挂起线程，等待确认）
  → respond
```

- 无提案（`stopReason='no_target'`）时条件边直连 `respond`，不进入 review。
- 无 checkpointer（降级）时**不插入** review 节点与边，行为与现状一致。

**状态扩展**（`state.ts`）：

```typescript
pendingReview?: {
  proposalIds: string[];
  status: 'pending' | 'approved' | 'rejected';
  expiresAt?: string;   // 取提案最早过期时间
  decidedAt?: string;
  note?: string;
};
// stopReason 增加 'awaiting_review'
```

### 4. 确认端点与恢复执行

```
POST /assistant/conversations/:conversationId/confirm
Body: { proposalIds: string[]; decision: 'approved'|'rejected'; note?: string }
```

服务端流程（`core.service.confirmProposal` → `runtime.service.resumeConversation`）：

1. 校验会话归属（复用 `conversation.service`）。
2. 用同一 checkpointer 构建图 → `graph.getState({ configurable: { thread_id } })`：
   - `pendingReview` 不存在或 `status !== 'pending'` → `badRequest`（已决/不存在）；
   - `expiresAt` 已过 → `badRequest`（过期，需重新发起）。
3. `graph.invoke(new Command({ resume: { decision, note } }), { configurable: { thread_id } })` 恢复线程：
   - `write_review` 重跑，`interrupt` 返回 decision → 更新 `pendingReview.status/decidedAt/note`；
   - 边到 `respond` 生成确认回复（文案引导客户端执行真实写入）。
4. 返回 `{ conversationId, decision, status, finalContent }`。

**关键约束**：checkpoint 会序列化 state，**函数不可进 state**；`executeTools` 仍走 deps 传入（每次请求 build 图，checkpointer 共享——图结构一致即可恢复线程；resume 路径不会调用 executeTools）。

### 5. 降级矩阵

| 条件                  | 行为                                     |
| --------------------- | ---------------------------------------- |
| 无 `conversationId`   | 不传 thread_id；不 interrupt（旧行为）   |
| checkpointer 为 null  | 不插 review 节点；旧行为                 |
| 提案过期              | confirm 拒绝（badRequest），提示重新发起 |
| confirm 重复/未知线程 | badRequest                               |

---

## 文件结构

**新建：**

- `src/modules/assistant/agent/checkpointer.service.ts` — PostgresSaver 封装（getSaver/setup/降级）
- `src/modules/assistant/agent/checkpointer.service.spec.ts`
- `src/modules/assistant/agent/runtime/review.ts` — `createWriteReviewSetupNode` / `createWriteReviewNode`（interrupt）
- `src/modules/assistant/agent/runtime/review.spec.ts`
- `src/modules/assistant/dto/confirm-proposal.dto.ts` — 确认请求/响应 DTO

**修改：**

- `src/modules/assistant/agent/runtime/state.ts` — `pendingReview`、`stopReason` 扩展
- `src/modules/assistant/agent/runtime/graph.ts` — deps 增 `checkpointer?/conversationId?`、条件边、review 节点
- `src/modules/assistant/agent/runtime/graph.spec.ts`
- `src/modules/assistant/agent/runtime.service.ts` — checkpointer 注入、invoke config、`resumeConversation`
- `src/modules/assistant/agent/runtime.service.spec.ts`
- `src/modules/assistant/services/core.service.ts` — `confirmProposal`、stream 传 conversationId
- `src/modules/assistant/services/core.service.spec.ts`
- `src/modules/assistant/assistant.controller.ts` — confirm 端点
- `src/modules/assistant/assistant.controller.spec.ts`
- `src/modules/assistant/dto/stream-messages.dto.ts` — 可选 `conversationId`
- `src/modules/assistant/assistant.module.ts` — 提供 checkpointer
- `package.json` — 依赖
- `docs/02-logs/migration-log/2026-08-01.md`、`docs/00-current/Assistant_Runtime.md` — 文档

---

## Phase 1: 依赖与 Checkpointer 服务

- [ ] **Step 1: 安装依赖并确认 API**

```bash
pnpm add @langchain/langgraph-checkpoint-postgres
```

安装后读取 `node_modules/@langchain/langgraph-checkpoint-postgres/dist/index.d.ts`，确认：

- `PostgresSaver` 构造签名（`{ pool }` 或 `{ pool, schemaName? }`）；
- `setup()` / `migrate()` 是否存在及幂等性。

- [ ] **Step 2: 写失败测试** `src/modules/assistant/agent/checkpointer.service.spec.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AssistantCheckpointerService } from './checkpointer.service';

function buildService(databaseUrl: string | undefined) {
  const configService = {
    get: vi.fn((key: string) =>
      key === 'DATABASE_URL' ? databaseUrl : undefined,
    ),
  } as unknown as ConfigService;
  return new AssistantCheckpointerService(configService);
}

describe('AssistantCheckpointerService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when DATABASE_URL is missing', async () => {
    const service = buildService(undefined);
    await service.onModuleInit();
    expect(service.getSaver()).toBeNull();
  });

  it('builds a PostgresSaver and runs setup()', async () => {
    const service = buildService('postgres://user:pw@localhost:5432/lucent');
    await service.onModuleInit();
    expect(service.getSaver()).not.toBeNull();
  });
});
```

- [ ] **Step 3: 实现** `src/modules/assistant/agent/checkpointer.service.ts`

```typescript
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';
import { EnvKey } from '../../../config/env/env-keys.enum';

/**
 * 进程级共享的 Postgres checkpoint 提供方。
 * DATABASE_URL 缺失或初始化失败时返回 null，调用方降级为无 checkpoint 的旧行为。
 */
@Injectable()
export class AssistantCheckpointerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssistantCheckpointerService.name);
  private saver: BaseCheckpointSaver | null = null;
  private pool: Pool | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const databaseUrl = this.configService.get<string>(EnvKey.DATABASE_URL);
    if (databaseUrl == null || databaseUrl.length === 0) {
      this.logger.warn(
        'DATABASE_URL missing; assistant checkpoint persistence disabled',
      );
      return;
    }
    try {
      this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
      const postgresSaver = new PostgresSaver({ pool: this.pool });
      await postgresSaver.setup(); // 幂等建表；若类型定义要求 migrate() 则随后调用
      this.saver = postgresSaver;
      this.logger.log('Assistant checkpoint persistence ready');
    } catch (error) {
      this.logger.error(
        `Checkpoint init failed; falling back: ${String(error)}`,
      );
      await this.pool?.end();
      this.pool = null;
      this.saver = null;
    }
  }

  getSaver(): BaseCheckpointSaver | null {
    return this.saver;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm exec vitest run src/modules/assistant/agent/checkpointer.service.spec.ts
```

预期：缺 URL 用例 PASS；有 URL 用例需要真实 DB，若 CI 无 DB 则将该用例改为 mock `PostgresSaver`（`vi.mock('@langchain/langgraph-checkpoint-postgres')`）。

- [ ] **Step 5: 在 module 提供**

`src/modules/assistant/assistant.module.ts`：`providers` 增加 `AssistantCheckpointerService`，并在需要处导入。

- [ ] **Step 6: 提交**

```bash
git -C Lucent add src/modules/assistant/agent/checkpointer.service.ts src/modules/assistant/agent/checkpointer.service.spec.ts src/modules/assistant/assistant.module.ts package.json pnpm-lock.yaml
git -C Lucent commit -m "feat(assistant): add postgres checkpointer service"
```

---

## Phase 2: 状态扩展与图内审批节点

- [ ] **Step 1: 扩展状态** `src/modules/assistant/agent/runtime/state.ts`

```typescript
export type AssistantProposalReviewStatus = 'pending' | 'approved' | 'rejected';

export interface AssistantPendingReview {
  proposalIds: string[];
  status: AssistantProposalReviewStatus;
  expiresAt?: string;
  decidedAt?: string;
  note?: string;
}
```

- `AssistantRuntimeState` 增字段：`pendingReview?: AssistantPendingReview`（reducer：右覆盖）。
- `stopReason` union 增 `'awaiting_review'`。

- [ ] **Step 2: 实现 review 节点** `src/modules/assistant/agent/runtime/review.ts`

```typescript
import { SystemMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import type { AssistantRuntimeState } from './state';

/** interrupt 载荷：暴露给挂起线程调用方的提案信息 */
export interface AssistantReviewRequest {
  proposalIds: string[];
  expiresAt?: string;
}

/** 客户端确认后 resume 传入的决定 */
export interface AssistantReviewDecision {
  decision: 'approved' | 'rejected';
  note?: string;
}

/** 从工具结果提取提案元数据（供 write_review_setup 使用） */
export function collectProposalReview(
  toolResults: readonly AssistantRuntimeState['toolResults'],
): AssistantReviewRequest | null {
  const proposalIds = toolResults.flatMap(
    (result) => result.proposedActions?.map((action) => action.id) ?? [],
  );
  if (proposalIds.length === 0) return null;
  const expiresAt = toolResults
    .flatMap((result) => result.proposedActions ?? [])
    .map((action) => action.expiresAt)
    .filter((value): value is string => value != null)
    .sort()[0];
  return { proposalIds, expiresAt };
}

/** 节点 1：提取提案并写入 pendingReview（挂起前状态可被 getState 读取） */
export function createWriteReviewSetupNode() {
  return (state: AssistantRuntimeState) => {
    const review = collectProposalReview(state.toolResults);
    if (review == null) {
      return { stopReason: 'no_target' as const };
    }
    return {
      pendingReview: { ...review, status: 'pending' as const },
      stopReason: 'awaiting_review' as const,
    };
  };
}

/** 节点 2：interrupt 挂起线程，resume 后把决定写回 pendingReview */
export function createWriteReviewNode() {
  return async (state: AssistantRuntimeState) => {
    const pending = state.pendingReview;
    const review =
      pending != null
        ? { proposalIds: pending.proposalIds, expiresAt: pending.expiresAt }
        : collectProposalReview(state.toolResults);
    const decision = await interrupt<AssistantReviewDecision>(review);
    return {
      pendingReview: {
        ...(pending ?? review),
        status: decision.decision,
        decidedAt: new Date().toISOString(),
        note: decision.note,
      },
      messages: [
        ...state.messages,
        new SystemMessage(
          decision.decision === 'approved'
            ? 'The user approved the proposal. Confirm the write still needs to be applied on the client side; do not claim it was applied automatically.'
            : 'The user rejected the proposal. Do not perform or imply any write.',
        ),
      ],
    };
  };
}
```

- [ ] **Step 3: 集成到主图** `src/modules/assistant/agent/runtime/graph.ts`

- `AssistantGraphDeps` 增 `checkpointer?: BaseCheckpointSaver | null`、`conversationId?: string`。
- 导入 `BaseCheckpointSaver`（`@langchain/langgraph`）。
- `hasHithl = deps.checkpointer != null`；仅当 `hasHithl` 时：

```typescript
.addNode('write_review_setup', createWriteReviewSetupNode())
.addNode('write_review', createWriteReviewNode())
// write_subgraph 之后：
.addConditionalEdges('write_subgraph', (state) =>
  state.pendingReview != null ? 'write_review_setup' : 'respond')
.addEdge('write_review_setup', 'write_review')
.addEdge('write_review', 'respond')
```

- 非 `hasHithl` 时保持 `write_subgraph → respond` 直连（现状）。
- `compile({ cache: ASSISTANT_NODE_CACHE, checkpointer: deps.checkpointer ?? undefined })`。

- [ ] **Step 4: 失败测试** `src/modules/assistant/agent/runtime/review.spec.ts`（用 `MemorySaver`）

```typescript
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { buildAssistantRuntimeGraph } from './graph';

it('interrupts write flow and resumes on approval', async () => {
  const mockModel = {
    bindTools: vi.fn().mockReturnThis(),
    invoke: vi
      .fn()
      .mockResolvedValue({
        content: '已确认，请在记录页完成保存。',
        tool_calls: [],
      }),
  };
  const graph = buildAssistantRuntimeGraph({
    createModel: () => mockModel as never,
    executeTools: async () => [],
    buildSystemPrompt: () => 'system',
    checkpointer: new MemorySaver(),
  }).compile({ cache: undefined });

  const input = {
    userId: 'user-1',
    userMessage: '帮我记录今天喝水 500ml',
    locale: 'zh-CN',
    enabledContextSources: ['health_profile'],
  };
  // 第一次：挂起等待审批
  await expect(
    graph.invoke(input, { configurable: { thread_id: 'conv-1' } }),
  ).rejects.toThrow(/interrupt/i); // 无 resume 时 interrupt 抛出 GraphInterrupt

  const snapshot = await graph.getState({
    configurable: { thread_id: 'conv-1' },
  });
  expect(snapshot.values.pendingReview?.status).toBe('pending');

  // resume：批准
  const resumed = await graph.invoke(
    { resume: { decision: 'approved', note: 'ok' } } as never,
    { configurable: { thread_id: 'conv-1' } },
  );
  expect(resumed.pendingReview?.status).toBe('approved');
});
```

> 注意：`interrupt` 无 resume 时抛出的错误类为 `GraphInterrupt`（`@langchain/langgraph` 导出，可用 `isGraphInterrupt` 判断）。实际失败断言以 1.4.2 行为为准（挂起时 invoke 可能返回而非抛出，见 Step 5 校正）。

- [ ] **Step 5: 运行并校正行为断言**

```bash
pnpm exec vitest run src/modules/assistant/agent/runtime/review.spec.ts
```

按 1.4.2 实际语义调整：interrupt 挂起时 `invoke` 的行为（抛 `GraphInterrupt` 或返回 `{ __interrupt__ }`）；resume 用 `graph.invoke(new Command({ resume: decision }), config)`（`import { Command } from '@langchain/langgraph'`）。**以真实运行结果为准修改测试与实现。**

- [ ] **Step 6: 提交**

```bash
git -C Lucent add src/modules/assistant/agent/runtime/state.ts src/modules/assistant/agent/runtime/review.ts src/modules/assistant/agent/runtime/review.spec.ts src/modules/assistant/agent/runtime/graph.ts
git -C Lucent commit -m "feat(assistant): add in-graph proposal review interrupt nodes"
```

---

## Phase 3: thread_id 接线

- [ ] **Step 1: DTO 加可选 conversationId** `src/modules/assistant/dto/stream-messages.dto.ts`

```typescript
@ApiProperty({ description: 'Optional persisted conversation id used as LangGraph thread id.', required: false })
@IsOptional()
@IsString()
@MaxLength(64)
conversationId?: string;
```

- [ ] **Step 2: `runtime.service.ts` 注入 checkpointer 并传 config**

- 构造注入 `AssistantCheckpointerService`。
- `runConversation` input 增 `conversationId?: string`；invoke 时：

```typescript
const checkpointer = this.checkpointerService.getSaver();
const graph = buildAssistantRuntimeGraph({
  ...deps,
  checkpointer,
  conversationId: input.conversationId,
});
const config =
  input.conversationId != null && checkpointer != null
    ? { configurable: { thread_id: input.conversationId } }
    : undefined;
const result = await graph.invoke(input, config);
```

- [ ] **Step 3: `core.service.ts` 透传 conversationId**

`streamMessages` 调用 `runConversation` 时增加 `conversationId: dto.conversationId`。

- [ ] **Step 4: 更新既有 spec 构造参数**

`runtime.service.spec.ts` / `core.service.spec.ts` 所有 `new AssistantRuntimeService(...)` 增加 checkpointer mock（`{ getSaver: () => null }`），保持旧行为断言通过。

- [ ] **Step 5: 验证**

```bash
pnpm exec vitest run src/modules/assistant/agent/runtime.service.spec.ts src/modules/assistant/services/core.service.spec.ts
```

- [ ] **Step 6: 提交**

```bash
git -C Lucent add src/modules/assistant/dto/stream-messages.dto.ts src/modules/assistant/agent/runtime.service.ts src/modules/assistant/services/core.service.ts src/modules/assistant/agent/runtime.service.spec.ts src/modules/assistant/services/core.service.spec.ts
git -C Lucent commit -m "feat(assistant): wire conversation thread id into graph invoke"
```

---

## Phase 4: 确认端点与恢复执行

- [ ] **Step 1: DTO** `src/modules/assistant/dto/confirm-proposal.dto.ts`

```typescript
export class ConfirmAssistantProposalDto {
  @ApiProperty({
    description: 'Proposal ids awaiting confirmation.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  proposalIds!: string[];

  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AssistantConfirmResultDto {
  conversationId!: string;
  decision!: 'approved' | 'rejected';
  status!: 'approved' | 'rejected';
  finalContent!: string | null;
}
```

- [ ] **Step 2: `runtime.service.ts` 新增 `resumeConversation`**

```typescript
async resumeConversation(input: {
  userId: string;
  conversationId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}): Promise<{ finalContent: string | null }> {
  const checkpointer = this.checkpointerService.getSaver();
  if (checkpointer == null) {
    throw badRequest(ResultCode..., 'Checkpoint persistence is unavailable; cannot resume review.');
  }
  const graph = buildAssistantRuntimeGraph({ ...本请求 deps, checkpointer, conversationId: input.conversationId });
  const config = { configurable: { thread_id: input.conversationId } };
  const snapshot = await graph.getState(config);
  const pending = snapshot.values.pendingReview as AssistantPendingReview | undefined;
  if (pending == null || pending.status !== 'pending') {
    throw badRequest(..., 'No pending proposal review for this conversation.');
  }
  if (pending.expiresAt != null && new Date(pending.expiresAt).getTime() < Date.now()) {
    throw badRequest(..., 'The proposal review expired. Ask the assistant to regenerate it.');
  }
  const result = await graph.invoke(new Command({ resume: { decision: input.decision, note: input.note } }), config);
  return { finalContent: result.finalContent ?? null };
}
```

> 错误响应统一走项目现有 `badRequest`/`ResultCode` 风格（与 `core.service` 一致）；delegate 到 `core.service` 时透传用户态错误。

- [ ] **Step 3: `core.service.ts` 新增 `confirmProposal`**

```typescript
async confirmProposal(
  userId: string,
  conversationId: string,
  dto: ConfirmAssistantProposalDto,
): Promise<AssistantConfirmResultDto> {
  const conversation = await this.conversationService.getConversation(userId, conversationId);
  if (conversation == null) {
    throw badRequest(ResultCode..., 'Conversation not found.');
  }
  const { finalContent } = await this.assistantAgentService.resumeConversation({
    userId,
    conversationId,
    decision: dto.decision,
    note: dto.note,
  });
  return {
    conversationId,
    decision: dto.decision,
    status: dto.decision,
    finalContent,
  };
}
```

- [ ] **Step 4: controller 端点** `src/modules/assistant/assistant.controller.ts`

```typescript
@Post('conversations/:conversationId/confirm')
@ApiOperation({ summary: 'Confirm or reject pending assistant write proposals and resume the graph thread' })
@ApiResponse({ status: 200, type: AssistantConfirmResultDto })
async confirmProposal(
  @CurrentUser() user: UserPayload,
  @Param('conversationId') conversationId: string,
  @Body() dto: ConfirmAssistantProposalDto,
) {
  return successEnvelope(
    await this.assistantService.confirmProposal(user.sub, conversationId, dto),
  );
}
```

- [ ] **Step 5: spec**

- `runtime.service.spec.ts`：`resumeConversation` 过期 / 已决 / 正常 resume 三用例（graph 用 MemorySaver 真跑或 mock `graph.getState/invoke`）。
- `core.service.spec.ts`：`confirmProposal` 会话不存在 → badRequest；正常路径透传。
- `assistant.controller.spec.ts`：端点参数与响应 envelope。

- [ ] **Step 6: 验证与提交**

```bash
pnpm exec vitest run src/modules/assistant
git -C Lucent add src/modules/assistant/dto/confirm-proposal.dto.ts src/modules/assistant/agent/runtime.service.ts src/modules/assistant/services/core.service.ts src/modules/assistant/assistant.controller.ts src/modules/assistant/agent/runtime.service.spec.ts src/modules/assistant/services/core.service.spec.ts src/modules/assistant/assistant.controller.spec.ts
git -C Lucent commit -m "feat(assistant): add proposal confirm endpoint with thread resume"
```

---

## Phase 5: 测试补全与全量验证

- [ ] **Step 1: graph.spec 增补（MemorySaver 全链路）**

- 无 checkpointer → write 分支无 review（`stopReason` 不出现 `awaiting_review`）。
- 有 checkpointer + thread_id：挂起 → `getState` 有 `pendingReview(status=pending)` → resume approved → `pendingReview.status='approved'`，respond 产出回复。
- resume rejected → status='rejected'，回复不声称已写入。
- 无 `conversationId` → 不挂起（旧行为）。

- [ ] **Step 2: 全量验证**

```bash
pnpm lint:check
pnpm typecheck
pnpm test:ci
pnpm build
pnpm docs:check
```

- [ ] **Step 3: 文档**

- `docs/02-logs/migration-log/2026-08-01.md` 追加本节：checkpoint（PostgresSaver/setup/thread_id）、两段式 review 节点、confirm 端点、降级矩阵、依赖 `@langchain/langgraph-checkpoint-postgres`。
- `docs/00-current/Assistant_Runtime.md` 追加：会话 thread 持久化、图内 interrupt 审批、确认端点。

- [ ] **Step 4: 提交**

```bash
git -C Lucent add docs/02-logs/migration-log/2026-08-01.md docs/00-current/Assistant_Runtime.md
git -C Lucent commit -m "docs(assistant): record checkpoint persistence and in-graph review"
```

---

## 风险与备选

- **interrupt 挂起/恢复语义**：以本地 `@langchain/langgraph@1.4.2` 实际行为为准（Phase 2 Step 5 校正）；备选是把 interrupt 移入 write 子图内部或改用 `compile({ interruptBefore: ['respond'] })` 静态中断点。
- **PostgresSaver 版本差异**：`setup()`/`migrate()` 按安装后类型定义调用（Phase 1 Step 1 验证）。
- **测试环境无 DB**：spec 全部用 `MemorySaver` 或 mock，checkpointer service 的 DB 用例只在有 `DATABASE_URL` 时跑（或 mock `PostgresSaver`）。
- **state 序列化**：`executeTools` 等函数严禁入 state（checkpoint 序列化会失败），保持 deps 注入。
