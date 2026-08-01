# Lucent 测试缺口修复计划

> **For agentic workers:** 按任务清单逐项执行，每项完成后运行对应验证命令并提交。
> 步骤使用复选框（`- [ ]`）跟踪进度。

**Goal:** 消除 Lucent 单元测试的最大缺口——medicines risk-check 子系统（0–14% 覆盖率）与中等覆盖率服务，并修复一个会导致 `pnpm test:ci` 失败的 flaky 测试。

**Architecture:** 全部为单元测试（`vitest`，Nest 依赖用 `vi.fn()` 直接实例化，无 DB/Redis 依赖，与现有 `recognition-queue.service.spec.ts` 模式一致）+ 少量 e2e 补充。纯函数 utils 优先（价值高、零依赖），随后是服务编排层，最后是控制器端点与 e2e。

**Tech Stack:** Vitest 4（v8 coverage）、NestJS 11、Prisma 7（mock）、cache-manager（mock）、class-validator（mock）、pdf-lib（修复 flaky）。

---

## 现状基线（2026-08-01 实测）

- 单元测试：**259 文件 / 2637 用例**（`pnpm test:ci`）。
- 总行覆盖率：**85%**（7291/8582）。阈值：`lines 80 / functions 78 / statements 79 / branches 68`。
- **CI 阻断**：`src/modules/data-export/services/report-pdf/pdf.service.spec.ts` 的 `builds a multi-page hospital pdf with metadata` 用例在 30s 超时（实测 30092ms），`pnpm test:ci` 会因此失败退出（exit 1）。
- e2e：`test/e2e/**` 已覆盖大部分模块，但 **medicines risk-check 端点（GET/POST /medicines/risk-check）零覆盖**。
- 工具链告警：vitest 4 下 `esbuild: false` 已失效（默认 oxc 转换），清空 `node_modules/.vite` 后覆盖率归属正常（`classify.ts` 0% 为缓存污染误报，实测 100%）。

### 缺口清单

| 级别 | 文件                                                      | 当前覆盖率    | 说明                                         |
| ---- | --------------------------------------------------------- | ------------- | -------------------------------------------- |
| P0   | `data-export/services/report-pdf/pdf.service.spec.ts`     | flaky         | 30s 超时，CI 阻断                            |
| P1   | `medicines/utils/ingredient-canonicalization.ts`          | 1.1% (1/87)   | 纯函数，风险检查核心依赖                     |
| P1   | `medicines/utils/allergy-severity.ts`                     | 11.1% (1/9)   | 纯函数                                       |
| P1   | `medicines/services/risk/risk-detection.service.ts`       | 0.8% (1/126)  | 评分/红黄旗/食物相互作用逻辑                 |
| P1   | `medicines/services/risk/risk-context-builder.service.ts` | 2% (1/49)     | LLM context 组装                             |
| P1   | `medicines/services/risk/risk-check.service.ts`           | 4.3% (3/69)   | 编排 + 缓存 + 持久化                         |
| P1   | `medicines/services/risk/risk-llm-generator.service.ts`   | 14.3% (1/7)   | BaseLlmGenerator 子类                        |
| P1   | `medicines/services/risk/risk-check.listener.ts`          | 0%            | 事件监听 + debounce                          |
| P1   | `medicines/prompts/risk-check.prompt.ts`                  | 0%            | 纯函数 prompt 构建                           |
| P1   | `medicines/medicines.controller.ts`                       | 43.3% (13/30) | risk-check/recognize 端点未测                |
| P1   | `test/e2e/medicines/risk-check.e2e-spec.ts`（新建）       | —             | 端点级 e2e 缺失                              |
| P2   | `today-analysis/today-analysis.controller.ts`             | 50%           | 有测试但端点不全                             |
| P2   | `assistant/agent/runtime.service.ts`                      | 60%           | 有测试但分支不足                             |
| P2   | `auth/services/auth.service.ts`                           | 66.7%         | 补充失败分支                                 |
| P2   | `auth/controllers/oauth.controller.ts`                    | 66.7%         | 补充回调/登出分支                            |
| P2   | `app.controller.ts`                                       | 66.7%         | 补充健康检查变体                             |
| P2   | `today-suggestion/today-suggestion.controller.ts`         | 68.8%         | 补充错误分支                                 |
| P2   | `today-analysis/services/pipeline/copy.service.ts`        | 68.8%         | 补充空数据分支                               |
| P3   | `setup-app.ts`                                            | 5.3%          | 仅补纯函数；setupApp 本体由 e2e 覆盖，不单测 |

### 明确不属于缺口（排除项）

- **DTO / module / index / enum / types 声明文件（0%）**：无业务逻辑，由 e2e 与控制器测试覆盖，不为它们写 spec。
- **`assistant/agent/runtime/classify.ts`（报告 0%）**：`node_modules/.vite` 缓存污染的误报；清缓存后 `classify.spec.ts`（6 用例）覆盖 100%。验证方式见 Phase 7。
- **`main.ts` / `app.module.ts`**：进程入口与组合根，无单测价值。

---

## Phase 0: 修复 flaky PDF 测试（P0，CI 阻断）

**问题**：`pdf.service.spec.ts` 两个用例显式传 `30000` 超时，首个用例在多页医院 PDF 生成慢的机器上恰好超时（实测 30092ms）。`ci-unit` 跑 `pnpm test:ci`，无超时覆盖 → CI 随机失败。

**Files:**

- Modify: `src/modules/data-export/services/report-pdf/pdf.service.spec.ts:7,27,41`

- [ ] **Step 0.1: 提高超时并标注慢测试**

将两个 `it(...)` 末尾的 `, 30000)` 改为 `, 120_000)`，并加注释说明是重负载 PDF 渲染（CI 环境更慢）：

```typescript
// 慢测试：多页医院 PDF 渲染在 CI/低配机器上可超 30s，放宽到 120s
it('builds a multi-page hospital pdf with metadata', async () => {
  // ... 原有断言不变 ...
}, 120_000);
```

- [ ] **Step 0.2: 验证**

```bash
cd Lucent
pnpm test -- data-export/services/report-pdf/pdf.service.spec
```

Expected: `Test Files 1 passed`、`Tests 2 passed`，无 timeout。

- [ ] **Step 0.3: Commit**

```bash
git add src/modules/data-export/services/report-pdf/pdf.service.spec.ts docs/02-logs/migration-log/2026-08-01.md
git commit -m "test(data-export): 放宽 PDF 慢测试超时到 120s 修复 CI flaky"
```

---

## Phase 1: risk-check 纯函数 utils 测试（P1）

### Task 1.1: `ingredient-canonicalization.ts`（1.1% → ≥90%）

**Files:**

- Create: `src/modules/medicines/utils/ingredient-canonicalization.spec.ts`
- Test: 同上

- [ ] **Step 1.1.1: 写测试**

覆盖：`normalizeToken`、`asNonEmptyString`、`firstNonEmpty`、`extractIngredientTokens`（括号/剂量/分隔符清洗）、`canonicalIngredientKeysFor`（变体归一到 canonical key）、`expandCanonicalIngredientTokens`（变体扩展）、`duplicateIngredientEvidence`（排序）、`getDisplayName`（displayName 优先于 detail.name）、`getCanonicalIngredientKeys`（cn 走 ingredients / drugbank 走 synonyms）、`getDrugbankSynonymTokens`、`getDrugbankIds`（drugbank 用 sourceRefId / cn 用 drugbankIds 数组）、`getDrugbankInteractionTargets`（过滤非字符串/空值）、`getAllSourceIngredientTokens`（canonical keys + displayName token）。

```typescript
import { describe, expect, it } from 'vitest';
import {
  asNonEmptyString,
  canonicalIngredientKeysFor,
  duplicateIngredientEvidence,
  expandCanonicalIngredientTokens,
  extractIngredientTokens,
  firstNonEmpty,
  getAllSourceIngredientTokens,
  getCanonicalIngredientKeys,
  getDisplayName,
  getDrugbankIds,
  getDrugbankInteractionTargets,
  getDrugbankSynonymTokens,
  normalizeToken,
  type MedicineDetailWrapper,
} from './ingredient-canonicalization';

function wrapper(
  overrides: {
    source?: 'cn' | 'drugbank' | 'manual';
    displayName?: string;
    name?: string;
    detail?: Record<string, unknown>;
    sourceRefId?: string | null;
  } = {},
): MedicineDetailWrapper {
  return {
    item: {
      id: 'm1',
      source: overrides.source ?? 'cn',
      sourceRefId: overrides.sourceRefId ?? 's1',
      displayName: overrides.displayName ?? ' 阿司匹林肠溶片 ',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    detail: {
      id: 'd1',
      source: overrides.source ?? 'cn',
      name: overrides.name ?? 'Aspirin',
      detail: overrides.detail ?? {},
    } as unknown as MedicineDetailWrapper['detail'],
  };
}

describe('normalizeToken', () => {
  it('lowercases and strips all whitespace', () => {
    expect(normalizeToken('  IBUprofeN 100mg ')).toBe('ibuprofen100mg');
  });
});

describe('asNonEmptyString', () => {
  it('trims and returns text', () => {
    expect(asNonEmptyString('  abc  ')).toBe('abc');
  });
  it('returns null for empty / blank / null', () => {
    expect(asNonEmptyString('')).toBeNull();
    expect(asNonEmptyString('   ')).toBeNull();
    expect(asNonEmptyString(null)).toBeNull();
    expect(asNonEmptyString(undefined)).toBeNull();
  });
});

describe('firstNonEmpty', () => {
  it('returns the first non-empty argument', () => {
    expect(firstNonEmpty('', 'b', null)).toBe('b');
    expect(firstNonEmpty('a', 'b', 'c')).toBe('a');
    expect(firstNonEmpty('', '', '')).toBeNull();
  });
});

describe('extractIngredientTokens', () => {
  it('splits on separators and strips strengths', () => {
    const tokens = extractIngredientTokens(
      '对乙酰氨基酚(扑热息痛) 500mg、布洛芬+咖啡因；维生素C and 维生素B1',
    );
    expect(tokens.has(normalizeToken('对乙酰氨基酚'))).toBe(true);
    expect(tokens.has(normalizeToken('扑热息痛'))).toBe(true);
    expect(tokens.has(normalizeToken('布洛芬'))).toBe(true);
    expect(tokens.has(normalizeToken('咖啡因'))).toBe(true);
    expect(tokens.has(normalizeToken('维生素C'))).toBe(true);
    expect(tokens.has(normalizeToken('维生素B1'))).toBe(true);
    // 剂量被剥离
    expect(tokens.has('500mg')).toBe(false);
  });
});

describe('canonicalIngredientKeysFor', () => {
  it('maps variants to the canonical key', () => {
    const keys = canonicalIngredientKeysFor(
      new Set([normalizeToken('paracetamol')]),
    );
    expect(keys.has('acetaminophen')).toBe(true);
  });
  it('keeps unknown tokens as-is', () => {
    const keys = canonicalIngredientKeysFor(new Set(['someunknown']));
    expect(keys.has('someunknown')).toBe(true);
  });
});

describe('expandCanonicalIngredientTokens', () => {
  it('expands one variant into the full variant family', () => {
    const expanded = expandCanonicalIngredientTokens(
      new Set([normalizeToken('阿司匹林')]),
    );
    expect(expanded.has('aspirin')).toBe(true);
    expect(expanded.has(normalizeToken('乙酰水杨酸'))).toBe(true);
  });
});

describe('duplicateIngredientEvidence', () => {
  it('joins sorted tokens', () => {
    expect(duplicateIngredientEvidence(new Set(['b', 'a']))).toBe('a / b');
  });
});

describe('getDisplayName', () => {
  it('prefers trimmed item displayName over detail.name', () => {
    expect(getDisplayName(wrapper({ displayName: ' 布洛芬缓释胶囊 ' }))).toBe(
      '布洛芬缓释胶囊',
    );
  });
  it('falls back to detail.name when displayName is blank', () => {
    expect(
      getDisplayName(wrapper({ displayName: '   ', name: 'Fallback Name' })),
    ).toBe('Fallback Name');
  });
});

describe('getCanonicalIngredientKeys', () => {
  it('extracts cn ingredients and maps to canonical keys', () => {
    const med = wrapper({
      detail: { ingredients: '对乙酰氨基酚 500mg, 伪麻黄碱' },
    });
    const keys = getCanonicalIngredientKeys(med);
    expect(keys.has('acetaminophen')).toBe(true);
    expect(keys.has(normalizeToken('伪麻黄碱'))).toBe(true);
  });
  it('returns empty set for manual sources', () => {
    expect(getCanonicalIngredientKeys(wrapper({ source: 'manual' })).size).toBe(
      0,
    );
  });
});

describe('getDrugbankSynonymTokens', () => {
  it('returns name + synonyms for drugbank source', () => {
    const med = wrapper({
      source: 'drugbank',
      name: 'Aspirin',
      detail: { synonyms: ['Acetylsalicylic Acid', '  '] },
    });
    const tokens = getDrugbankSynonymTokens(med);
    expect(tokens.has('aspirin')).toBe(true);
    expect(tokens.has(normalizeToken('acetylsalicylic acid'))).toBe(true);
    expect(tokens.has('')).toBe(false);
  });
  it('returns empty set for non-drugbank sources', () => {
    expect(getDrugbankSynonymTokens(wrapper({ source: 'cn' })).size).toBe(0);
  });
});

describe('getDrugbankIds', () => {
  it('uses sourceRefId for drugbank source', () => {
    expect(
      getDrugbankIds(wrapper({ source: 'drugbank', sourceRefId: 'DB0001' })),
    ).toEqual(new Set(['DB0001']));
  });
  it('reads drugbankIds array for cn source', () => {
    const med = wrapper({
      source: 'cn',
      detail: { drugbankIds: ['DB0001', '  ', 'DB0002'] },
    });
    expect(getDrugbankIds(med)).toEqual(new Set(['DB0001', 'DB0002']));
  });
});

describe('getDrugbankInteractionTargets', () => {
  it('extracts non-empty drugbankId targets', () => {
    const med = wrapper({
      source: 'drugbank',
      detail: {
        drugInteractions: [
          { drugbankId: 'DB0001', description: 'x' },
          { drugbankId: '  ', description: 'blank' },
          null,
          'string-not-object',
        ],
      },
    });
    expect(getDrugbankInteractionTargets(med)).toEqual(new Set(['DB0001']));
  });
  it('returns empty set for non-drugbank sources', () => {
    expect(getDrugbankInteractionTargets(wrapper({ source: 'cn' })).size).toBe(
      0,
    );
  });
});

describe('getAllSourceIngredientTokens', () => {
  it('includes canonical keys and the normalized display name', () => {
    const med = wrapper({
      displayName: '对乙酰氨基酚片',
      detail: { ingredients: '对乙酰氨基酚' },
    });
    const tokens = getAllSourceIngredientTokens(med);
    expect(tokens.has('acetaminophen')).toBe(true);
    expect(tokens.has(normalizeToken('对乙酰氨基酚片'))).toBe(true);
  });
});
```

- [ ] **Step 1.1.2: 运行确认通过**

```bash
pnpm test -- medicines/utils/ingredient-canonicalization.spec
```

Expected: `1 passed`，用例全绿。

- [ ] **Step 1.1.3: Commit**

```bash
git add src/modules/medicines/utils/ingredient-canonicalization.spec.ts
git commit -m "test(medicines): 补齐 ingredient-canonicalization 纯函数测试"
```

### Task 1.2: `allergy-severity.ts`（11.1% → 100%）

**Files:**

- Create: `src/modules/medicines/utils/allergy-severity.spec.ts`

- [ ] **Step 1.2.1: 写测试**

```typescript
import { describe, expect, it } from 'vitest';
import {
  inferredAllergySeverity,
  isSevereAllergy,
  type AllergyRecord,
} from './allergy-severity';

function allergy(overrides: Partial<AllergyRecord> = {}): AllergyRecord {
  return {
    label: '青霉素',
    reaction: null,
    severity: null,
    isActive: true,
    ...overrides,
  };
}

describe('inferredAllergySeverity', () => {
  it('returns severe when reaction contains anaphylaxis keywords', () => {
    expect(inferredAllergySeverity(allergy({ reaction: '过敏性休克' }))).toBe(
      'severe',
    );
    expect(
      inferredAllergySeverity(allergy({ reaction: 'Anaphylaxis reported' })),
    ).toBe('severe');
  });
  it('falls back to the recorded severity', () => {
    expect(inferredAllergySeverity(allergy({ severity: 'moderate' }))).toBe(
      'moderate',
    );
  });
  it('returns unknown when severity is missing / blank / unknown', () => {
    expect(inferredAllergySeverity(allergy())).toBe('unknown');
    expect(inferredAllergySeverity(allergy({ severity: '' }))).toBe('unknown');
    expect(inferredAllergySeverity(allergy({ severity: 'UNKNOWN' }))).toBe(
      'unknown',
    );
  });
});

describe('isSevereAllergy', () => {
  it('is true only for severe', () => {
    expect(isSevereAllergy(allergy({ severity: 'severe' }))).toBe(true);
    expect(isSevereAllergy(allergy({ severity: 'mild' }))).toBe(false);
    expect(isSevereAllergy(allergy())).toBe(false);
  });
});
```

- [ ] **Step 1.2.2: 运行确认通过**（`pnpm test -- medicines/utils/allergy-severity.spec`）
- [ ] **Step 1.2.3: Commit**

```bash
git add src/modules/medicines/utils/allergy-severity.spec.ts
git commit -m "test(medicines): 补齐 allergy-severity 纯函数测试"
```

---

## Phase 2: `risk-detection.service.ts` 测试（P1，0.8% → ≥85%）

**Files:**

- Create: `src/modules/medicines/services/risk/risk-detection.service.spec.ts`

- [ ] **Step 2.1: 写测试**

直接实例化 `new RiskDetectionService()`（无依赖）。用例矩阵：

1. **空输入**：无 details / allergies / uncovered → `riskScore 0`、`riskLevel 'safe'`、三个数组为空。
2. **评分函数（经 evaluateStaticRisk 间接验证）**：
   - 仅 high 严重度 finding → score ≥ 30；`scoreToLevel` 边界：10→safe、11→caution、40→caution、41→risk、70→risk、71→danger（通过构造不同 findings 验证 level）。
   - coverageIssue 每个 +3；`severeAllergy` redFlag +40，其他 redFlag +10；总分 cap 100。
3. **过敏匹配**：allergy label 出现在 cn ingredients（token 匹配）或 contraindications/precautions（haystack 匹配）→ 产出 `allergy` finding；severity 映射：severe→high、moderate→medium、mild→info、unknown→high。
4. **食物相互作用**：`foodInteractions` 含 alcohol/酒 → `medium + context alcohol`；含 caffeine/咖啡/浓茶 → `info + context caffeine`；非字符串条目跳过。
5. **药物对相互作用**：A.drugInteractions.target 命中 B 的 drugbankId（及反向）→ `interaction/high` finding，且 `secondaryMedicineName` 指向另一方；无交集 → 不产出。
6. **重复成分**：两药 canonical key 交集非空 → `duplicateIngredient/medium` finding，evidence 为排序后的共享 token。
7. **覆盖问题**：manual → `manualEntry`；sourceRefId 空 → `missingSourceRef`；其余 → `detailUnavailable`。
8. **红旗**：severe 过敏 + allergy finding → `severeAllergy` 红旗；severe 过敏 + 有覆盖问题 → 最多 2 个 `informationGap` 红旗（无 severe 过敏时不触发）。

```typescript
import { describe, expect, it } from 'vitest';
import { RiskDetectionService } from './risk-detection.service';
import type { MedicineDetailWrapper } from '../../utils/ingredient-canonicalization';
import type { AllergyRecord } from '../../utils/allergy-severity';

const svc = new RiskDetectionService();

function med(
  overrides: {
    source?: 'cn' | 'drugbank';
    name?: string;
    displayName?: string;
    sourceRefId?: string | null;
    detail?: Record<string, unknown>;
  } = {},
): MedicineDetailWrapper {
  return {
    item: {
      id: overrides.sourceRefId ?? 'm1',
      source: overrides.source ?? 'cn',
      sourceRefId: overrides.sourceRefId ?? 'm1',
      displayName: overrides.displayName ?? overrides.name ?? 'TestMed',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    detail: {
      id: 'd',
      source: overrides.source ?? 'cn',
      name: overrides.name ?? 'TestMed',
      detail: overrides.detail ?? {},
    } as unknown as MedicineDetailWrapper['detail'],
  };
}

const allergy = (overrides: Partial<AllergyRecord> = {}): AllergyRecord => ({
  label: '对乙酰氨基酚',
  reaction: null,
  severity: null,
  isActive: true,
  ...overrides,
});

describe('RiskDetectionService.evaluateStaticRisk', () => {
  it('returns safe/0 for empty inputs', () => {
    const result = svc.evaluateStaticRisk([], [], []);
    expect(result.riskScore).toBe(0);
    expect(result.riskLevel).toBe('safe');
    expect(result.findings).toEqual([]);
    expect(result.coverageIssues).toEqual([]);
    expect(result.redFlags).toEqual([]);
  });

  it('caps risk score at 100 and maps level boundaries', () => {
    const manyHigh = Array.from({ length: 10 }, (_, i) =>
      med({
        name: `Med${i}`,
        sourceRefId: `m${i}`,
        detail: { foodInteractions: ['alcohol'] },
      }),
    );
    // 每个酒精相互作用 medium +15 → 10*15 = 150 → cap 100
    const result = svc.evaluateStaticRisk(manyHigh, [], []);
    expect(result.riskScore).toBe(100);
    expect(result.riskLevel).toBe('danger');
  });

  it('produces allergy findings via token match on cn ingredients', () => {
    const result = svc.evaluateStaticRisk(
      [med({ detail: { ingredients: '对乙酰氨基酚 500mg' } })],
      [allergy()],
      [],
    );
    const f = result.findings.find((x) => x.type === 'allergy');
    expect(f).toBeDefined();
    expect(f?.relatedLabel).toBe('对乙酰氨基酚');
    expect(f?.severity).toBe('high'); // unknown severity → high
  });

  it('maps allergy severity: moderate → medium, mild → info, severe → high', () => {
    const caseSeverity = (a: AllergyRecord): string | undefined =>
      svc
        .evaluateStaticRisk(
          [med({ detail: { ingredients: a.label } })],
          [a],
          [],
        )
        .findings.find((x) => x.type === 'allergy')?.severity;

    expect(
      caseSeverity(allergy({ label: '青霉素', severity: 'moderate' })),
    ).toBe('medium');
    expect(caseSeverity(allergy({ label: '青霉素', severity: 'mild' }))).toBe(
      'info',
    );
    expect(caseSeverity(allergy({ label: '青霉素', severity: 'severe' }))).toBe(
      'high',
    );
  });

  it('detects alcohol and caffeine food interactions', () => {
    const result = svc.evaluateStaticRisk(
      [
        med({
          detail: {
            foodInteractions: ['Avoid alcohol', '咖啡因敏感', 'plain'],
          },
        }),
      ],
      [],
      [],
    );
    const alcohol = result.findings.find((x) => x.context === 'alcohol');
    const caffeine = result.findings.find((x) => x.context === 'caffeine');
    expect(alcohol?.severity).toBe('medium');
    expect(caffeine?.severity).toBe('info');
  });

  it('detects pair interaction when A targets B (and reverse)', () => {
    const a = med({
      source: 'drugbank',
      sourceRefId: 'DB_A',
      name: 'DrugA',
      detail: {
        drugInteractions: [{ drugbankId: 'DB_B', description: 'avoid combo' }],
      },
    });
    const b = med({ source: 'drugbank', sourceRefId: 'DB_B', name: 'DrugB' });
    const forward = svc.evaluateStaticRisk([a, b], [], []);
    const f = forward.findings.find((x) => x.type === 'interaction');
    expect(f?.primaryMedicineName).toBe('DrugA');
    expect(f?.secondaryMedicineName).toBe('DrugB');
    expect(f?.evidence).toBe('avoid combo');

    // 反向：B 也列出 A 为目标
    const a2 = med({
      source: 'drugbank',
      sourceRefId: 'DB_A',
      name: 'DrugA',
      detail: { drugInteractions: [{ drugbankId: 'DB_B', description: 'x' }] },
    });
    const b2 = med({
      source: 'drugbank',
      sourceRefId: 'DB_B',
      name: 'DrugB',
      detail: { drugInteractions: [{ drugbankId: 'DB_A', description: 'y' }] },
    });
    const reverse = svc.evaluateStaticRisk([a2, b2], [], []);
    const r = reverse.findings.find((x) => x.type === 'interaction');
    expect(r?.primaryMedicineName).toBe('DrugB');
    expect(r?.secondaryMedicineName).toBe('DrugA');
  });

  it('detects duplicate ingredients via canonical keys', () => {
    const a = med({
      name: '泰诺',
      detail: { ingredients: '对乙酰氨基酚 500mg' },
    });
    const b = med({
      name: '散利痛',
      sourceRefId: 'm2',
      detail: { ingredients: '扑热息痛 250mg' },
    });
    const result = svc.evaluateStaticRisk([a, b], [], []);
    const f = result.findings.find((x) => x.type === 'duplicateIngredient');
    expect(f?.primaryMedicineName).toBe('泰诺');
    expect(f?.secondaryMedicineName).toBe('散利痛');
    expect(f?.evidence).toContain('acetaminophen');
  });

  it('classifies coverage issues by source', () => {
    const manual = {
      id: 'm1',
      source: 'manual',
      sourceRefId: null,
      displayName: '手录药',
    };
    const noRef = {
      id: 'm2',
      source: 'cn',
      sourceRefId: '',
      displayName: '缺引用',
    };
    const unresolvable = {
      id: 'm3',
      source: 'cn',
      sourceRefId: 'x',
      displayName: '查不到',
    };
    const result = svc.evaluateStaticRisk(
      [],
      [],
      [manual, noRef, unresolvable],
    );
    expect(result.coverageIssues).toEqual([
      { medicineName: '手录药', reason: 'manualEntry' },
      { medicineName: '缺引用', reason: 'missingSourceRef' },
      { medicineName: '查不到', reason: 'detailUnavailable' },
    ]);
  });

  it('raises severeAllergy and informationGap red flags', () => {
    const severe = allergy({ label: '青霉素', severity: 'severe' });
    const result = svc.evaluateStaticRisk(
      [med({ name: '青霉素V钾', detail: { ingredients: '青霉素' } })],
      [severe],
      [{ id: 'm2', source: 'cn', sourceRefId: '', displayName: '缺引用药' }],
    );
    expect(result.redFlags.some((r) => r.rule === 'severeAllergy')).toBe(true);
    expect(
      result.redFlags.filter((r) => r.rule === 'informationGap').length,
    ).toBeLessThanOrEqual(2);
    expect(result.riskScore).toBeGreaterThanOrEqual(40); // severeAllergy +40
  });

  it('does not raise severeAllergy without an allergy finding', () => {
    const result = svc.evaluateStaticRisk(
      [med({ detail: { ingredients: '布洛芬' } })],
      [allergy({ label: '青霉素', severity: 'severe' })],
      [],
    );
    expect(result.redFlags).toEqual([]);
  });
});
```

> 注：`calculateRiskScore` / `scoreToLevel` 是模块私有函数，通过 `evaluateStaticRisk` 间接断言即可（白盒行为等价）；如需直接测试，可在 spec 内导出前临时改名，但按 YAGNI 不做。

- [ ] **Step 2.2: 运行确认通过**

```bash
pnpm test -- medicines/services/risk/risk-detection.service.spec
```

Expected: `1 passed` 全绿。

- [ ] **Step 2.3: Commit**

```bash
git add src/modules/medicines/services/risk/risk-detection.service.spec.ts
git commit -m "test(medicines): 补齐 risk-detection 静态风险评估测试"
```

---

## Phase 3: prompt / context-builder / llm-generator 测试（P1）

### Task 3.1: `risk-check.prompt.ts`（0% → 100%）

**Files:**

- Create: `src/modules/medicines/prompts/risk-check.prompt.spec.ts`

- [ ] **Step 3.1.1: 写测试**

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildMedicineRiskSystemPrompt,
  buildMedicineRiskUserPrompt,
  type MedicineRiskLlmContext,
} from './risk-check.prompt';

const ctx: MedicineRiskLlmContext = {
  medicines: [
    {
      name: '布洛芬',
      source: 'cn',
      ingredients: '布洛芬',
      contraindications: '胃溃疡',
      precautions: '饭后服用',
      foodInteractions: ['酒'],
      drugInteractions: [{ target: 'DB0001', description: 'x' }],
      startedAt: '2026-01-01',
    },
  ],
  allergies: [{ label: '青霉素', severity: 'unknown', reaction: '皮疹' }],
  conditions: [{ label: '高血压', status: 'active' }],
  reminders: [
    {
      medicineName: '布洛芬',
      scheduledHour: 8,
      scheduledMinute: 30,
      daysOfWeek: [1, 3],
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    },
  ],
  staticFindings: [
    { type: 'allergy', severity: 'high', description: '匹配青霉素' },
  ],
};

describe('buildMedicineRiskSystemPrompt', () => {
  it('contains analyst role and safety boundaries', () => {
    const prompt = buildMedicineRiskSystemPrompt();
    expect(prompt).toContain('medicine safety analyst');
    expect(prompt).toContain('Do not recommend starting, stopping');
    expect(prompt).toContain('structured output');
  });
});

describe('buildMedicineRiskUserPrompt', () => {
  it('serializes medicines, allergies, conditions, reminders, findings', () => {
    const prompt = buildMedicineRiskUserPrompt(ctx, {} as never);
    expect(prompt).toContain('## Current Medicines');
    expect(prompt).toContain('- 布洛芬 (source: cn)');
    expect(prompt).toContain('Ingredients: 布洛芬');
    expect(prompt).toContain('Drug interactions: DB0001: x');
    expect(prompt).toContain('- 青霉素 (severity: unknown) reaction: 皮疹');
    expect(prompt).toContain('- 高血压 (status: active)');
    expect(prompt).toContain(
      '- 布洛芬 at 08:30 on days: 1,3 from 2026-01-01 until 2026-02-01',
    );
    expect(prompt).toContain('- [high] allergy: 匹配青霉素');
  });

  it('renders (none) placeholders for empty sections', () => {
    const prompt = buildMedicineRiskUserPrompt(
      {
        medicines: [],
        allergies: [],
        conditions: [],
        reminders: [],
        staticFindings: [],
      },
      {} as never,
    );
    expect(prompt).toContain('(none)');
  });
});
```

- [ ] **Step 3.1.2: 运行确认通过**（`pnpm test -- medicines/prompts/risk-check.prompt.spec`）
- [ ] **Step 3.1.3: Commit**

```bash
git add src/modules/medicines/prompts/risk-check.prompt.spec.ts
git commit -m "test(medicines): 补齐 risk-check prompt 构建测试"
```

### Task 3.2: `risk-context-builder.service.ts`（2% → ≥85%）

**Files:**

- Create: `src/modules/medicines/services/risk/risk-context-builder.service.spec.ts`

- [ ] **Step 3.2.1: 写测试**

mock `PrismaService`（`user.findFirst`、`userMedicineReminder.findMany`）与 `MedicinesService`（`getDetailWithCache`）。用例：

1. 用户为空 → medicines/allergies/conditions/reminders 空数组；reminders 查询仍执行。
2. 正常路径：cn 药 detail 的 ingredients/contraindications/precautions/foodInteractions/drugInteractions/startedAt 被组装进 `medicines`；`drugInteractions` 只保留字符串 drugbankId + description；`foodInteractions` 只保留字符串。
3. `getDetailWithCache` reject → 跳过该药并 warn，不抛错。
4. sourceRefId 为空或 source 非 cn/drugbank → 不纳入 eligible。
5. reminders 关联 `currentMedicineId` 找不到对应药 → 该 reminder 被过滤；`daysOfWeek` 只保留 number。
6. 静态 findings 拼装 `description`（含 secondary + relatedLabel + evidence）。

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Cache } from 'cache-manager';
import { RiskContextBuilderService } from './risk-context-builder.service';
import type { PrismaService } from '../../../../prisma';
import type { MedicinesService } from '../medicines.service';

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    allergies: [
      { label: '青霉素', reaction: null, severity: 'severe', isActive: true },
    ],
    conditions: [{ label: '高血压', status: 'active' }],
    currentMedicines: [
      {
        id: 'cm1',
        source: 'cn',
        sourceRefId: 'cn-1',
        displayName: '布洛芬缓释胶囊',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

function build() {
  const prisma = {
    user: { findFirst: vi.fn() },
    userMedicineReminder: { findMany: vi.fn() },
  } as unknown as PrismaService;
  const medicinesService = {
    getDetailWithCache: vi.fn(),
  } as unknown as MedicinesService;
  const svc = new RiskContextBuilderService(prisma, medicinesService);
  return { prisma, medicinesService, svc };
}

const staticResult = {
  overallRiskLevel: 'caution',
  overallRiskScore: 15,
  currentMedicineCount: 1,
  checkedMedicineCount: 1,
  findings: [
    {
      type: 'allergy',
      severity: 'high',
      primaryMedicineName: '布洛芬缓释胶囊',
      relatedLabel: '青霉素',
      evidence: 'contraindications text',
    },
  ],
  coverageIssues: [],
  redFlags: [],
} as never;

describe('RiskContextBuilderService.buildLlmContext', () => {
  it('returns empty sections when user is missing', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([]);

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.medicines).toEqual([]);
    expect(ctx.allergies).toEqual([]);
    expect(ctx.conditions).toEqual([]);
    expect(ctx.reminders).toEqual([]);
    expect(medicinesService.getDetailWithCache).not.toHaveBeenCalled();
  });

  it('assembles medicine detail and skips rejected detail fetches', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(userRecord());
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([]);
    vi.mocked(medicinesService.getDetailWithCache)
      .mockResolvedValueOnce({
        id: 'cn-1',
        source: 'cn',
        name: '布洛芬缓释胶囊',
        detail: {
          ingredients: '布洛芬',
          contraindications: '胃溃疡',
          precautions: '饭后服用',
          foodInteractions: ['酒', 42],
          drugInteractions: [
            { drugbankId: 'DB0001', description: '相互作用说明' },
            { drugbankId: '', description: 'x' },
          ],
        },
      } as never)
      .mockRejectedValueOnce(new Error('fetch failed'));

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(userRecord());
    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.medicines).toHaveLength(1);
    expect(ctx.medicines[0]).toMatchObject({
      name: '布洛芬缓释胶囊',
      source: 'cn',
      ingredients: '布洛芬',
      contraindications: '胃溃疡',
      precautions: '饭后服用',
      foodInteractions: ['酒'],
      drugInteractions: [{ target: 'DB0001', description: '相互作用说明' }],
      startedAt: '2026-01-01',
    });
    expect(ctx.allergies).toEqual([
      { label: '青霉素', severity: 'severe', reaction: null },
    ]);
    expect(ctx.conditions).toEqual([{ label: '高血压', status: 'active' }]);
  });

  it('filters reminders that do not map to a current medicine and keeps numeric daysOfWeek', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(userRecord());
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([
      {
        id: 'r1',
        currentMedicineId: 'cm1',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1, 'bad'],
        startDate: new Date('2026-01-01'),
        endDate: null,
        isActive: true,
      },
      {
        id: 'r2',
        currentMedicineId: 'ghost',
        scheduledHour: 9,
        scheduledMinute: 0,
        daysOfWeek: null,
        startDate: null,
        endDate: null,
        isActive: true,
      },
    ]);
    vi.mocked(medicinesService.getDetailWithCache).mockResolvedValue({
      id: 'cn-1',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      detail: {},
    } as never);

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.reminders).toEqual([
      {
        medicineName: '布洛芬缓释胶囊',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1],
        startDate: '2026-01-01',
      },
    ]);
  });

  it('serializes static findings with secondary and evidence', async () => {
    const { prisma, medicinesService, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(userRecord());
    vi.mocked(prisma.userMedicineReminder.findMany).mockResolvedValue([]);
    vi.mocked(medicinesService.getDetailWithCache).mockResolvedValue({
      id: 'cn-1',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      detail: {},
    } as never);

    const ctx = await svc.buildLlmContext('u1', staticResult);

    expect(ctx.staticFindings).toEqual([
      {
        type: 'allergy',
        severity: 'high',
        description:
          '布洛芬缓释胶囊 (allergen: 青霉素) — contraindications text',
      },
    ]);
  });
});
```

- [ ] **Step 3.2.2: 运行确认通过**（`pnpm test -- medicines/services/risk/risk-context-builder.service.spec`）
- [ ] **Step 3.2.3: Commit**

```bash
git add src/modules/medicines/services/risk/risk-context-builder.service.spec.ts
git commit -m "test(medicines): 补齐 risk-context-builder LLM context 组装测试"
```

### Task 3.3: `risk-llm-generator.service.ts`（14.3% → ≥85%）

**Files:**

- Create: `src/modules/medicines/services/risk/risk-llm-generator.service.spec.ts`

- [ ] **Step 3.3.1: 写测试**

`MedicineRiskLlmGeneratorService` 继承 `BaseLlmGeneratorService`（已有 `base-llm-generator.service.spec.ts` 覆盖基类）。本 spec 聚焦子类专属行为：`hasAnalysisModel`、`generate` 委托走 `llmRuntime`。参考 `base-llm-generator.service.spec.ts` 的 mock 构造方式（`mockRuntime`、`mockMetrics`、`mockCircuitBreaker`）。

```typescript
import { describe, expect, it, vi } from 'vitest';
import { MedicineRiskLlmGeneratorService } from './risk-llm-generator.service';
import type { LlmRuntimeService } from '../../../../llm-runtime';
import type { MetricsService } from '../../../../common/metrics/metrics.service';
import type { LlmCircuitBreakerService } from '../../../../common/llm/llm-circuit-breaker.service';
import type { MedicineRiskLlmContext } from '../../prompts/risk-check.prompt';

function build(hasAnalysisModel = true) {
  const runtime = {
    hasModel: vi.fn(() => hasAnalysisModel),
    generateStructured: vi.fn().mockResolvedValue({ data: { riskScore: 5 } }),
  } as unknown as LlmRuntimeService;
  const metrics = {} as unknown as MetricsService;
  const circuitBreaker = {
    isOpen: () => false,
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  } as unknown as LlmCircuitBreakerService;
  const svc = new MedicineRiskLlmGeneratorService(
    runtime,
    metrics,
    circuitBreaker,
  );
  return { runtime, svc };
}

const ctx: MedicineRiskLlmContext = {
  medicines: [],
  allergies: [],
  conditions: [],
  reminders: [],
  staticFindings: [],
};

describe('MedicineRiskLlmGeneratorService', () => {
  it('reports model availability from the runtime', () => {
    const { svc } = build(true);
    expect(svc.hasAnalysisModel()).toBe(true);
    const { svc: svc2 } = build(false);
    expect(svc2.hasAnalysisModel()).toBe(false);
  });

  it('delegates generate to the runtime and returns parsed output', async () => {
    const { runtime, svc } = build();
    const result = await svc.generate(ctx);
    expect(runtime.generateStructured).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { riskScore: 5 } });
  });
});
```

> 注：若 `BaseLlmGeneratorService.generate` 的实际返回结构与本 spec 假设不符，以基类 spec 为准调整断言——先跑测试看失败信息，再对齐 mock 返回形状。

- [ ] **Step 3.3.2: 运行确认通过**（`pnpm test -- medicines/services/risk/risk-llm-generator.service.spec`）

> 若失败且原因是 mock 形状不符，对照 `src/common/llm/base-llm-generator.service.spec.ts` 的 `mockRuntime`/`generateStructured` 签名修正后重跑。

- [ ] **Step 3.3.3: Commit**

```bash
git add src/modules/medicines/services/risk/risk-llm-generator.service.spec.ts
git commit -m "test(medicines): 补齐 risk-llm-generator 委托与模型可用性测试"
```

---

## Phase 4: `risk-check.service.ts` + `risk-check.listener.ts` 测试（P1）

### Task 4.1: `risk-check.service.ts`（4.3% → ≥85%）

**Files:**

- Create: `src/modules/medicines/services/risk/risk-check.service.spec.ts`

- [ ] **Step 4.1.1: 写测试**

mock `PrismaService`（`medicineRiskCheckRecord.findMany/upsert/updateMany`、`user.findFirst`）、`MedicinesService`、`MedicineRiskLlmGeneratorService`、`RiskDetectionService`、`RiskContextBuilderService`、`Cache`。用例：

1. `getRecords`：cache 命中直接返回；未命中查 DB（static/llm 两条）→ 映射 `toDto` → 写缓存并返回；两条均无 → `{static:null, llm:null}`。
2. `runStaticCheck`：`evaluateStaticCheck` 用户不存在 → 空 safe 响应并 upsert；用户存在 → 拉详情（`Promise.allSettled`，reject 跳过）→ `riskDetection.evaluateStaticRisk` → upsert + 缓存失效 → 返回 DTO。
3. `runLlmCheck`：`llmGenerator.hasAnalysisModel()` 为 false → throw `LLM analysis model is not configured`；为 true → 静态结果 + `riskContextBuilder.buildLlmContext` + `llmGenerator.generate` → `mapLlmOutput`（secondaryMedicineName 可选、overallRecommendation 空时不输出）→ persist。
4. `markStale`：`updateMany` 置 stale，并 `cache.del`；`cache.del` reject 时不抛（warn）。
5. `persistRecord`：upsert 的 create/update 分支与缓存失效。

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { Cache } from 'cache-manager';
import { MedicineRiskCheckService } from './risk-check.service';
import type { PrismaService } from '../../../../prisma';
import type { MedicinesService } from '../medicines.service';
import type { MedicineRiskLlmGeneratorService } from './risk-llm-generator.service';
import type { RiskDetectionService } from './risk-detection.service';
import type { RiskContextBuilderService } from './risk-context-builder.service';

function build() {
  const prisma = {
    medicineRiskCheckRecord: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findFirst: vi.fn() },
  } as unknown as PrismaService;
  const medicinesService = {
    getDetailWithCache: vi.fn(),
  } as unknown as MedicinesService;
  const llmGenerator = {
    hasAnalysisModel: vi.fn(() => true),
    generate: vi.fn(),
  } as unknown as MedicineRiskLlmGeneratorService;
  const riskDetection = {
    evaluateStaticRisk: vi.fn().mockReturnValue({
      findings: [],
      coverageIssues: [],
      redFlags: [],
      riskScore: 0,
      riskLevel: 'safe',
    }),
  } as unknown as RiskDetectionService;
  const riskContextBuilder = {
    buildLlmContext: vi.fn(),
  } as unknown as RiskContextBuilderService;
  const cache = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  } as unknown as Cache;
  const svc = new MedicineRiskCheckService(
    prisma,
    medicinesService,
    llmGenerator,
    riskDetection,
    riskContextBuilder,
    cache,
  );
  return {
    prisma,
    medicinesService,
    llmGenerator,
    riskDetection,
    riskContextBuilder,
    cache,
    svc,
  };
}

const recordRow = {
  checkType: 'static',
  result: { overallRiskLevel: 'safe', overallRiskScore: 0 },
  riskScore: 0,
  riskLevel: 'safe',
  stale: false,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
};

describe('MedicineRiskCheckService', () => {
  it('getRecords returns cached value without touching the DB', async () => {
    const { prisma, cache, svc } = build();
    const cached = { static: null, llm: null };
    vi.mocked(cache.get).mockResolvedValue(cached as never);

    const result = await svc.getRecords('u1');

    expect(result).toEqual(cached);
    expect(prisma.medicineRiskCheckRecord.findMany).not.toHaveBeenCalled();
  });

  it('getRecords reads, maps and caches records from the DB', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.get).mockResolvedValue(undefined);
    vi.mocked(prisma.medicineRiskCheckRecord.findMany).mockResolvedValue([
      { ...recordRow, checkType: 'static' },
      { ...recordRow, checkType: 'llm' },
    ] as never);

    const result = await svc.getRecords('u1');

    expect(result.static?.checkType).toBe('static');
    expect(result.llm?.checkType).toBe('llm');
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('medicines:risk-check'),
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('runStaticCheck returns a safe empty response when the user is missing', async () => {
    const { prisma, svc } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue(
      recordRow as never,
    );

    const result = await svc.runStaticCheck('u1');

    expect(result.checkType).toBe('static');
    expect(prisma.medicineRiskCheckRecord.upsert).toHaveBeenCalled();
  });

  it('runLlmCheck throws when the LLM analysis model is not configured', async () => {
    const { llmGenerator, svc } = build();
    vi.mocked(llmGenerator.hasAnalysisModel).mockReturnValue(false);

    await expect(svc.runLlmCheck('u1')).rejects.toThrow(
      'LLM analysis model is not configured',
    );
  });

  it('runLlmCheck builds context, generates output and persists', async () => {
    const {
      prisma,
      medicinesService,
      llmGenerator,
      riskDetection,
      riskContextBuilder,
      svc,
    } = build();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.medicineRiskCheckRecord.upsert).mockResolvedValue({
      ...recordRow,
      checkType: 'llm',
    } as never);
    vi.mocked(riskContextBuilder.buildLlmContext).mockResolvedValue(
      {} as never,
    );
    vi.mocked(llmGenerator.generate).mockResolvedValue({
      riskScore: 10,
      riskLevel: 'caution',
      findings: [
        {
          type: 'interaction',
          severity: 'medium',
          title: 't',
          description: 'desc',
          recommendation: 'rec',
          primaryMedicineName: 'DrugA',
          secondaryMedicineName: 'DrugB',
        },
      ],
      overallRecommendation: 'consult doctor',
    } as never);

    const result = await svc.runLlmCheck('u1');

    expect(result.checkType).toBe('llm');
    expect(result.result.findings[0].secondaryMedicineName).toBe('DrugB');
    expect(result.result.overallRecommendation).toBe('consult doctor');
    expect(riskDetection.evaluateStaticRisk).toHaveBeenCalled();
  });

  it('markStale updates records and invalidates cache without throwing when cache.del fails', async () => {
    const { prisma, cache, svc } = build();
    vi.mocked(cache.del).mockRejectedValue(new Error('redis down'));

    await expect(svc.markStale('u1')).resolves.toBeUndefined();

    expect(prisma.medicineRiskCheckRecord.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { stale: true },
    });
  });
});
```

- [ ] **Step 4.1.2: 运行确认通过**（`pnpm test -- medicines/services/risk/risk-check.service.spec`）

> 若 mock 形状与实际方法签名有偏差（如 `upsert` 参数结构），以编译/运行报错为准修正。

- [ ] **Step 4.1.3: Commit**

```bash
git add src/modules/medicines/services/risk/risk-check.service.spec.ts
git commit -m "test(medicines): 补齐 risk-check 编排服务测试"
```

### Task 4.2: `risk-check.listener.ts`（0% → ≥90%）

**Files:**

- Create: `src/modules/medicines/services/risk/risk-check.listener.spec.ts`

- [ ] **Step 4.2.1: 写测试**

用 `vi.useFakeTimers()` 控制 5s debounce。用例：

1. `HEALTH_CONTEXT_CHANGED` → `markStale` 调用 + 调度静态检查；推进 5s 后 `runStaticCheck` 执行一次。
2. 同一用户连续两个事件 → 只执行一次（debounce 重置）。
3. `markStale` reject → 不阻塞调度（warn 后仍执行 runStaticCheck）。
4. `runStaticCheck` reject → 不抛（warn）。
5. `onModuleDestroy` → 清空所有 pending timer。

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MedicineRiskCheckListener } from './risk-check.listener';
import { MedicineRiskCheckService } from './risk-check.service';
import {
  HEALTH_CONTEXT_CHANGED,
  REMINDER_CHANGED,
} from '../../../../common/events/domain-events';

describe('MedicineRiskCheckListener', () => {
  const runStaticCheck = vi.fn();
  const markStale = vi.fn();
  let listener: MedicineRiskCheckListener;

  beforeEach(() => {
    vi.useFakeTimers();
    runStaticCheck.mockReset();
    markStale.mockReset();
    runStaticCheck.mockResolvedValue(undefined);
    markStale.mockResolvedValue(undefined);
    const svc = {
      markStale,
      runStaticCheck,
    } as unknown as MedicineRiskCheckService;
    listener = new MedicineRiskCheckListener(svc);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks stale and schedules a debounced static check on health-context change', async () => {
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);

    expect(markStale).toHaveBeenCalledWith('u1');
    expect(runStaticCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(runStaticCheck).toHaveBeenCalledTimes(1);
    expect(runStaticCheck).toHaveBeenCalledWith('u1');
  });

  it('debounces a burst of events into a single check', async () => {
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    await vi.advanceTimersByTimeAsync(3000);
    await listener.handleReminderChanged({ userId: 'u1' } as never);
    await vi.advanceTimersByTimeAsync(5000);

    expect(runStaticCheck).toHaveBeenCalledTimes(1);
  });

  it('schedules even when markStale fails', async () => {
    markStale.mockRejectedValue(new Error('db down'));
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    await vi.advanceTimersByTimeAsync(5000);

    expect(runStaticCheck).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the async static check rejects', async () => {
    runStaticCheck.mockRejectedValue(new Error('boom'));
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    await expect(vi.advanceTimersByTimeAsync(5000)).resolves.toBeUndefined();
  });

  it('clears pending timers on module destroy', async () => {
    await listener.handleHealthContextChanged({ userId: 'u1' } as never);
    listener.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(5000);

    expect(runStaticCheck).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4.2.2: 运行确认通过**（`pnpm test -- medicines/services/risk/risk-check.listener.spec`）
- [ ] **Step 4.2.3: Commit**

```bash
git add src/modules/medicines/services/risk/risk-check.listener.spec.ts
git commit -m "test(medicines): 补齐 risk-check 事件监听 debounce 测试"
```

---

## Phase 5: medicines controller 端点 + risk-check e2e（P1）

### Task 5.1: 扩展 `medicines.controller.spec.ts`（43.3% → ≥85%）

**Files:**

- Modify: `src/modules/medicines/medicines.controller.spec.ts`

- [ ] **Step 5.1.1: 补测试**

现有 spec 已 mock `MedicineRiskCheckService`（`getRecords`/`runStaticCheck`/`runLlmCheck`）。新增：

1. `GET risk-check` → 调 `getRecords(user.sub)`，返回 `successEnvelope`。
2. `POST risk-check` body `{ type: 'static' }` → 调 `runStaticCheck`；`{ type: 'llm' }` → 调 `runLlmCheck`。
3. `POST recognize` → 调 `medicinesService.recognizeMedicine(imageUrl)`。
4. `POST recognize/async` 与 `GET recognize/status/:jobId` → 委托 queue service（按现有 controller 实际签名补）。

```typescript
// 追加到现有 describe('MedicinesController') 内
describe('risk-check endpoints', () => {
  it('GET /risk-check returns records from the service', async () => {
    const records = { static: null, llm: null };
    (
      controller as unknown as {
        riskCheckService: { getRecords: ReturnType<typeof vi.fn> };
      }
    ).riskCheckService.getRecords.mockResolvedValue(records);

    const result = await controller.getRiskCheck({ sub: 'u1' } as never);
    expect(result.data).toEqual(records);
  });

  it('POST /risk-check dispatches static vs llm by body type', async () => {
    await controller.runRiskCheck(
      { sub: 'u1' } as never,
      { type: 'static' } as never,
    );
    await controller.runRiskCheck(
      { sub: 'u1' } as never,
      { type: 'llm' } as never,
    );
    const svc = (
      controller as unknown as {
        riskCheckService: {
          runStaticCheck: ReturnType<typeof vi.fn>;
          runLlmCheck: ReturnType<typeof vi.fn>;
        };
      }
    ).riskCheckService;
    expect(svc.runStaticCheck).toHaveBeenCalledWith('u1');
    expect(svc.runLlmCheck).toHaveBeenCalledWith('u1');
  });
});
```

> 执行时先读现有 spec 的 mock 结构，确认 `controller` 实例与 mock 命名（`getRecords`/`runStaticCheck` 等）后按实际字段调整上述代码。

- [ ] **Step 5.1.2: 运行确认通过**（`pnpm test -- modules/medicines/medicines.controller.spec`）
- [ ] **Step 5.1.3: Commit**

```bash
git add src/modules/medicines/medicines.controller.spec.ts
git commit -m "test(medicines): 补齐 controller risk-check/recognize 端点测试"
```

### Task 5.2: risk-check e2e（新建）

**Files:**

- Create: `test/e2e/medicines/risk-check.e2e-spec.ts`

- [ ] **Step 5.2.1: 写 e2e**

复用 `test/helpers/e2e-helpers.ts` 的 app 初始化与登录辅助。用例：

1. 未认证请求 GET/POST `/api/v1/medicines/risk-check` → 401。
2. 已认证 GET → 200 envelope，`data.static` 与 `data.llm` 可为 null（首查）。
3. 已认证 POST `{ type: 'static' }` → 200，返回 `checkType: 'static'` 的记录；再次 GET 能看到该记录。
4. POST `{ type: 'llm' }` 在 LLM 未配置的测试环境 → 预期 500（`LLM analysis model is not configured`），断言业务码（按现有错误处理断言方式）。

> e2e 依赖测试 runtime（Postgres/Redis）：本地先 `pnpm test:runtime:start`，跑完 `pnpm test:runtime:stop`；CI 的 `ci-e2e` job 自带 services。

```typescript
// 骨架 —— 以 test/e2e/medicines/medicines.e2e-spec.ts 的 app/setup 模式为准
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { initTestApp, loginAs } from '../../helpers/e2e-helpers';

describe('Medicine Risk Check API (e2e)', () => {
  let app: INestApplication;
  let auth: { token: string };

  beforeAll(async () => {
    app = await initTestApp();
    auth = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated GET', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/medicines/risk-check',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty records on first GET', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/medicines/risk-check',
      headers: { authorization: `Bearer ${auth.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.static).toBeNull();
    expect(body.data.llm).toBeNull();
  });

  it('runs a static check and persists the record', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/medicines/risk-check',
      headers: { authorization: `Bearer ${auth.token}` },
      payload: { type: 'static' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.checkType).toBe('static');
    expect(typeof body.data.riskScore).toBe('number');
  });
});
```

- [ ] **Step 5.2.2: 运行确认通过**

```bash
pnpm test:runtime:start
pnpm test:e2e -- medicines/risk-check
pnpm test:runtime:stop
```

Expected: `Test Files 1 passed`。

- [ ] **Step 5.2.3: Commit**

```bash
git add test/e2e/medicines/risk-check.e2e-spec.ts
git commit -m "test(medicines): 新增 risk-check 端点 e2e 覆盖"
```

---

## Phase 6: P2 中等覆盖率提升（目标单项 ≥80%）

**原则**：只补缺口分支，不重写现有 spec；每文件独立提交。

- [ ] **Task 6.1: `today-analysis/today-analysis.controller.ts`（50%）**
  - 读 `today-analysis.controller.spec.ts`，对照 controller 端点列表（含 SSE/stream、错误路径）补缺失用例。
  - 验证：`pnpm test -- today-analysis.controller.spec`
  - Commit：`test(today-analysis): 补齐 controller 端点覆盖`

- [ ] **Task 6.2: `assistant/agent/runtime.service.ts`（60%）**
  - 读 `runtime.service.spec.ts`，对照 `runtime.service.ts` 未覆盖分支（模型不可用、`runConversation` 错误路径、state 合并边界）补用例。
  - 验证：`pnpm test -- assistant/agent/runtime.service.spec`
  - Commit：`test(assistant): 补齐 runtime.service 分支覆盖`

- [ ] **Task 6.3: `auth/services/auth.service.ts`（66.7%）**
  - 读 `auth.service.spec.ts`，补登录失败分支（凭据错误/账号锁定/验证码错误）与登出幂等。
  - 验证：`pnpm test -- auth/services/auth.service.spec`
  - Commit：`test(auth): 补齐 auth.service 失败分支覆盖`

- [ ] **Task 6.4: `auth/controllers/oauth.controller.ts`（66.7%）**
  - 读 `oauth.controller.spec.ts`，补 provider 回调异常与未绑定 provider 的 400 分支。
  - 验证：`pnpm test -- auth/controllers/oauth.controller.spec`
  - Commit：`test(auth): 补齐 oauth.controller 回调分支覆盖`

- [ ] **Task 6.5: `app.controller.ts`（66.7%）**
  - 读 `app.controller.spec.ts`，补健康检查响应变体（如 DB 不可用时状态）与存活探针。
  - 验证：`pnpm test -- app.controller.spec`
  - Commit：`test(app): 补齐健康检查分支覆盖`

- [ ] **Task 6.6: `today-suggestion/today-suggestion.controller.ts`（68.8%）**
  - 读 `today-suggestion.controller.spec.ts`，对照控制器端点补错误路径（建议生成失败、历史为空、反馈非法）。
  - 验证：`pnpm test -- today-suggestion.controller.spec`
  - Commit：`test(today-suggestion): 补齐 controller 错误路径覆盖`

- [ ] **Task 6.7: `today-analysis/services/pipeline/copy.service.ts`（68.8%）**
  - 读 `copy.service.spec.ts`，补空输入/降级文案分支。
  - 验证：`pnpm test -- today-analysis/services/pipeline/copy.service.spec`
  - Commit：`test(today-analysis): 补齐 copy.service 降级分支覆盖`

- [ ] **Task 6.8: `setup-app.ts`（5.3%，P3）**
  - 补 `formatValidationErrors` 的空数组/多错误拼接用例（`setup-app.spec.ts` 内追加）。
  - `setupApp()` 本体不动：由 e2e 全链路覆盖（health/版本化/CORS 已在 `test/e2e/core/app.e2e-spec.ts`），不为 Fastify 实例写单测。
  - 验证：`pnpm test -- setup-app.spec`
  - Commit：`test(app): 补齐 setup-app 校验格式化纯函数用例`

---

## Phase 7: 验证与收尾

- [ ] **Task 7.1: 全量单测 + 覆盖率核对（清缓存）**

```bash
Remove-Item -Recurse -Force node_modules/.vite -ErrorAction SilentlyContinue
pnpm test:ci
pnpm test:coverage -- --testTimeout=90000 --reporter=dot
```

Expected：`pnpm test:ci` 零失败（PDF 用例不再超时）；coverage 报告中 medicines risk-check 相关文件 ≥85%，整体 lines ≥80 且通过阈值检查。

- [ ] **Task 7.2: 核对 classify.ts 归属**

```bash
pnpm exec vitest run src/modules/assistant/agent/runtime/classify.spec.ts --coverage --coverage.include="src/modules/assistant/agent/runtime/classify.ts"
```

Expected：`classify.ts` 覆盖率 ≥90%（确认此前 0% 为缓存误报，非真实缺口）。

- [ ] **Task 7.3: 文档与提交**

- 追加 `docs/02-logs/migration-log/2026-08-01.md`：记录新增 spec 文件清单、flaky 修复、覆盖率变化。
- 若 `docs/00-current/TODO.md` 有相关测试待办行 → 删除（已完成项删除，不留标记）。
- 如改动触及 API 契约或模块结构 → 按需 `pnpm export:openapi` / `pnpm docs:compodoc`（本计划纯新增测试，预期不需要）。
- 运行 `pnpm docs:check` 确认文档规则无遗漏。

```bash
git add docs/02-logs/migration-log/2026-08-01.md
git commit -m "docs: 记录测试缺口修复计划执行结果"
```

- [ ] **Task 7.4: 删除已完成的计划段**

按 Lucent 文档规则，执行完毕的计划段直接删除，不留 `✅` 标记；整个计划完成后删除本文件，并将持久结论（覆盖率基线、flaky 修复）落到 `docs/00-current/Code_Quality_Maintainability.md`。

---

## 完成标准

1. `pnpm test:ci` 全绿（含此前 flaky 的 PDF 用例）。
2. medicines risk-check 子系统（8 个源文件 + controller）单项覆盖率 ≥85%，`risk-check.prompt.ts` 100%。
3. 新增 `test/e2e/medicines/risk-check.e2e-spec.ts`，risk-check 端点 e2e 覆盖（401/首查空/static 持久化）。
4. P2 清单各文件覆盖率 ≥80%。
5. 全量 `pnpm test:coverage` 通过阈值（lines 80 / functions 78 / statements 79 / branches 68），整体行覆盖率 ≥86%。
6. `classify.ts` 0% 误报已确认排除（清缓存后 ≥90%）。
7. 迁移日志已追加；计划段执行完毕即删除。

## 风险与回滚

| 风险                                                 | 可能性 | 影响 | 缓解                                                          |
| ---------------------------------------------------- | ------ | ---- | ------------------------------------------------------------- |
| mock 形状与实际签名不符（upsert/generateStructured） | 中     | 低   | 每个 spec 先跑单文件验证；以编译/运行报错为准修正，不改源逻辑 |
| 假定时器与真实异步（markStale await）竞态            | 低     | 低   | listener spec 用 `advanceTimersByTimeAsync` 而非同步 advance  |
| e2e 依赖测试 runtime 未启动                          | 中     | 低   | Phase 5 明确 `test:runtime:start/stop`；CI 自带 services      |
| PDF 120s 超时仍不够（极端 CI 环境）                  | 低     | 低   | 若再超时，将该用例标记 `it.skipIf(process.env.CI)` 或拆分断言 |
| 覆盖率阈值因 DTO 文件 0% 拉低                        | 高     | 中   | 排除项已声明；若整体 lines 低于 80，先补 P2 分支而非 DTO 声明 |
