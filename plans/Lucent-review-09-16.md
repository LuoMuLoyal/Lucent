# Lucent 每日代码审查 · 2026-09-16

- 审阅日期：2026-09-16（上海时区）
- 提交区间：UTC 2026-09-15 16:00:00 ~ UTC 2026-09-16 15:59:59（= 上海 09-16 00:00:00 +0800 ~ 09-16 23:59:59 +0800）
- 最早 commit: 76de2e3
- 最晚 commit: 46c43ec
- commit 数: 22

## 一、当日主题

本日的工作可以归纳为三块主线：

1. **DrugBank 知识补全（核心）**：新增三张表（drugbank_target_sequences / drugbank_drug_sequences / drugbank_structures）和四个导入命令；详情接口补 `targets` 字段与 `sequenceSummary` 计数；新增 `GET /medicines/:id/sequences` 序列端点；用 XML 的 `<targets>/<enzymes>/<carriers>/<transporters>` 反向修复 CSV 行的 `relation_kind`/`actions`/`known_action`，并把 CSV/XML 重复条目去重。
2. **数据层与契约修正**：`externalIdentifiers` / `externalLinks` 从 `unknown()` 升级为强类型 Schema；`sleepContext` 字段命名 `startAt/endAt → startedAt/endedAt` 与 payload 一致；narrative 文案解码 XML 实体并剥离 inline markup；资源计划与 OpenAPI 再生成。
3. **稳定性与可观测性**：Logger 的 `stack` 数组形态回归成字符串（关键 bug 修复）；`meal-analysis` 过期回收独立 `job_lost` 失败码，避免与 `model_timeout` 归因混淆；限制条件达到封顶时不再谎报"Requested N meals" 文案。

## 二、本日发现

### 1. 🔴 critical: 暂无阻断性问题

本日变更确实修复了几个会引发线上事故的隐藏 bug（logger 数组 stack、meal digest 误导性提示），并未引入新的 critical 问题。

---

### 2. 🟡 warning

#### W1 · XML/CSV 靶点去重只看名字，未带物种信息，跨物种同名会误合并

- 文件：`src/modules/medicines/adapters/drugbank.service.ts:38-46` 的 `isCsvRelation` + `toTargets()`
- 代码：
  ```ts
  const xmlCoveredTargetIds = new Set(
    relations
      .filter((relation) => !isCsvRelation(relation.relationKind))
      .map((relation) => relation.targetId),
  );
  ```
- 风险：DrugBank 同名靶点跨物种存在（如 "Cyclooxygenase-1" 同时是 Human / Mouse / Rat），CSV 与 XML 在去重时只比较 `targetId`，但 `targetId` 来自上游基于 name+organism 的归一化。如果上游导入把同名的不同物种落到同一 `targetId`，就会把不该合并的 XML / CSV 边合并掉一个；更糟的是反过来——CSV 端引入一个未在 XML 中出现的物种条目时，CSV 行会被保留，但其指向的 `targetId` 与 XML 端的同名条目不一致，导致"同名的两个 target"被当成"不同的 target"，完全反过来。
- 推荐：在 `toTargets()` 里追加 `target.species` 与可选 `target.organism` 的复合 key 比较，或者干脆在外层导入阶段就把不同物种拆成独立 target 行；至少补一条 "name 相同时 species 不一致不要去重" 的单元用例。
- 出处：本日 PR 6be43d4 / e1ab32f 引入。

#### W2 · `xml_targets` 旁路字段全靠 destructure 剥离，容易随字段增多回归

- 文件：`scripts/import/medicine/import-medicine-knowledge.ts:1049-1059`
- 代码：
  ```ts
  const normalizedBatch = batch.map((record) => {
    const { xml_targets: xmlTargets, ...rest } = record;
    if (Array.isArray(xmlTargets) && xmlTargets.length > 0) { ... }
    return { ...rest, import_run_id: importRunId };
  });
  ```
- 风险：parser 端再多一个带 `_` 前缀或类似名字的字段（如 `xml_links`、`xml_aliases`），这个 `...rest` 会**默默**把它送进 `executeUpsert`，直到 PG 报"column not found"才被发现。`xml_targets` 是旁路字段而 schema 里的列只有十几列，没有 schema 校验护栏。
- 推荐：在导入前用一个 strict 的 record-shape 类型（如 `DrugRecordImport` 与 `DrugRecordWithSideChannel` 区分），让 TS 在编译期就拒收未声明字段；或者在 flush 之前调用一个 `pickKnownColumns(record, config.columns)` 函数显式落白名单。
- 出处：本日 PR 46c43ec / eb88d99。

#### W3 · Parser 把 `[label,L6616]` 里的 `L6616` 这种参考号也吞了，连带 `[CD-10, T1234]` 之类的复合引用一并消化

- 文件：`scripts/import/medicine/parsers/common.py:36-56` 的 `_REFERENCE_MARKER` 与 `_INLINE_LINK`
- 代码：
  ```py
  _REFERENCE_MARKER = re.compile(r"\[[A-Za-z_]*\s*,?\s*[A-Z]?\d{3,}\]")
  _INLINE_LINK = re.compile(r"\[[^\[\]]{1,80}\]")
  ```
- 风险：DrugBank 部分毒理条目会写 `[Homo sapiens]` 或 `[Bos taurus]` 这种字符串形式的拉丁名（没有数字），不会命中 `_REFERENCE_MARKER`；但 `ATPase [Actin]` 这种"括号里是补充说明"的形式会被 `_INLINE_LINK` 整体吞成 `Actin`，丢掉 `ATPase` 的修饰。同时已经在前面用 `_REFERENCE_MARKER` 摘掉 `[label,L6616]` 后，剩下 `[aspirin]` 这种"标签同义词"也确实应该解包——两个正则配合时序描述只覆盖了典型 case，没覆盖"补充说明型括号"。
- 推荐：在 `_INLINE_LINK` 加一些前置白名单：`[Homo sapiens]` 之类拉丁双词命中时不剥离；或者把 `_INLINE_LINK` 收紧为必须以 `[a-z]` 开头、单词数 ≤ 2；至少补一条"含拉丁名/补充说明"的保护用例。
- 出处：本日 PR c6e2ce3。

---

### 3. 🟢 suggestion

#### S1 · 测试 spec 直接读 `process.env['MEDICINE_DATA_ROOT']`，绕开 NestJS 的 ConfigService

- 文件：`scripts/import/medicine/drugbank-narrative-cleaning.spec.ts:31-35`、`drugbank-sequence-parsers.spec.ts:37-42`、`drugbank-structures-parser.spec.ts:30-33`
- 说明：这些是脚本侧的测试 fixture，不在 NestJS DI 内，理论上可以直接读环境变量。但 repository 其它 vitest 文件已经统一走 `ConfigService`，长期会形成两套入口。
- 推荐：保留现状（这些 spec 跑在 node 直执行、不在 NestJS 容器内），但注释里加一句"fixture 不在 DI 内、此处不必走 ConfigService"避免后续 reviewer 困惑；或者抽一个 `scripts/import/medicine/__fixtures__/data-root.ts` 单一来源。

#### S2 · `applyXmlTargetActions` 按 1000 chunk 串行 `await executeUpsert`，对大语料会拖慢导入

- 文件：`scripts/import/medicine/import-medicine-knowledge.ts:945-960`
- 说明：在 `for (let index = 0; index < rows.length; index += chunkSize)` 中串行 `await` 每个 chunk。DrugBank ~14000 药物、按 1/4 有靶点，大约 3500 个靶点行，单次 `for` 串行写只是几秒量级，但 `for await` 没有任何背压。
- 推荐：保留现状也无可厚非；如果导入时长开始成为瓶颈，把 chunks 收成 Promise.all 数组后 `Promise.allSettled`，配合 PG 连接池上限做一个并发上限即可。

#### S3 · Logger config.ts 的 `errorNormalizeFormat` 只清理 `info['error']` 不递归

- 文件：`src/common/logger/logger.config.ts:73-96`
- 说明：如果业务方传入 `error: { code: 'X', cause: { stack: [...] } }`，外层有数据所以保留，但内层 `cause.stack` 仍是数组，JSON 输出还是带着个数组字段。当前代码注释"已经满足 sink 形态"——其实只是说外层，本次修复只解决了直接调用 `logger.error(new Error())` 这一类常见路径。
- 推荐：在同函数里加一行 `if (Array.isArray(errorField?.['stack'])) { ... }` 以完全对齐 stack 形态；或文档写明"嵌套 cause 由调用方自行规范化"。

#### S4 · `MEDICINES_BYPASS_CACHE_HEADER` 没有在 controller 端对大小写做归一就对比 `value === 'no-cache'`

- 文件：`src/modules/medicines/medicines.controller.ts:188-203` 的 `shouldBypassCache()`
- 说明：测试 spec 给的是 `'true'/'1'/'no-cache'`，看起来 OK；但 header 是 client 发的，`Access-Control-Allow-Origin: 'true'` 这种巧合值也会被 bypass。概率低，不构成 critical。
- 推荐：抽一个 `@BooleanHeader()` 装饰器统一 trim/lowercase=`true`/`1` 的接受集合，controller 内不再各自解析。

#### S5 · 本日大量嵌套注释用中文(`// `、`/* */`)，与仓库既有英文注释规范存在差异

- 文件：`src/modules/medicines/cache/store.service.ts` 整段、`src/common/logger/logger.config.ts:140` 之后等多处。
- 说明：仓库此前大量注释是英文，本日新增的 medicines 模块多处用中文写注释。开放式协作不强制；但如果要给 AI / 国际化协作者一致体验，建议在 CONTRIBUTING.md 写明"comment 默认英文，可在中文白名单目录用中文"。
- 推荐：仅作提示，不需要立刻行动——保留各模块各自维护的语种也合理。

---

### 4. ✅ 本日做对的事（提炼供团队复用）

- **Logger 把 `stack: [...]` 还原成字符串** 修的是真 bug，VictoriaLogs / Loki 索引 stack 时遇到 array 会直接被丢进 `_dl` 字段。`prodJsonFormat` / `devConsoleFormat` 都把 `errorNormalizeFormat()` 放进 pipeline 最前面，让两侧 sink 看到一致形态——正中要点。
- **`job_lost` 与 `model_timeout` 拆分为独立失败码**，随附 OpenAPI / Zod Schema / 历史记录展示同步更新，整条链路（常量 / Schema / DTO / sweeper / 失败码定义处 / 测试）一起推——而不是只改 sweeper 内部——把"故障归因 vs 补救动作"两个维度清晰分开，评论里的故障归因论证可以保留。
- **序列端点分离** 没有把序列文本塞到 detail 响应里（Imatinib 一个蛋白 1130 aa × 28 个靶点 ≈ 32 KB 不归零的字符串），用 `getOrSetSequences` 复用了 `MEDICINES_DETAIL_CACHE_TTL_MS` 并独立 cache key——加 cache TTL、bypass header、序列懒加载三件事一次到位。
- **CSV/XML 重复条目去重** 用 `Set` 单遍扫 (`xmlCoveredTargetIds`)，先标记 XML 端的 targetId 再过滤 CSV 的相同 targetId，逻辑 O(n) 而非 O(n²)；且只丢 CSV 行，不丢 XML。
- **`drugbankExternalIdentifierSchema` / `drugbankExternalLinkSchema` / `drugbankTargetSchema`** 落地为 Zod 强类型，把 `externalIdentifiers` / `externalLinks` 从 `z.unknown()` 升级为带 `.describe()` 的明确 schema——`unknown()` 是临时契约，能替换就替换的做法是对的。
- **`MEDICINE_KNOWLEDGE_SOURCES` 已抽到 source.dto.ts**，新加 schema 不再裸枚举 `z.enum(['drugbank', 'cn'])`，一致性维护住了。

---

## 三、统计

- 修改/新增文件：51
- 新增行：+4420 / 删除行：-99
- 新增表：3（drugbank_target_sequences / drugbank_drug_sequences / drugbank_structures）
- 新增迁移文件：2
- 新增端点：1（GET /medicines/:id/sequences）
- 新增导入命令：4（drugbank-target-proteins / drugbank-target-genes / drugbank-drug-sequences / drugbank-structures）
- 新增失败原因码：1（job_lost）
- 新增 Zod schema：4（drugbankExternalIdentifier / drugbankExternalLink / drugbankTarget / drugbankDrugSequence / drugbankTargetSequence / medicineSequenceData / sequenceSummary 共 7 个）

## 四、后续动作建议

| 优先级 | 建议                                                       | 涉及 commit       |
| ------ | ---------------------------------------------------------- | ----------------- |
| 中     | 给 `toTargets()` 加 species-aware 去重并补一条用例         | 6be43d4 / e1ab32f |
| 中     | 把 `xml_targets` 旁路字段从 destructure 改成 strict record | 46c43ec / eb88d99 |
| 低     | `_INLINE_LINK` 加拉丁双词白名单 / 补补充说明型用例         | c6e2ce3           |
| 低     | Logger 规范化嵌套 `error.cause.stack`                      | 4ab5024 / 6bc91a0 |
| 低     | boolean header 抽公共装饰器                                | c5a1d66           |
