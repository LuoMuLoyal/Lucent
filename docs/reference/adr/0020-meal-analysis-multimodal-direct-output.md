# ADR-0020: 餐食分析改为一次多模态直出（区间 + 排序结论 + facets）

- **Status**: accepted
- **Date**: 2026-09-15
- **Deciders**: LuoMuLoyal

## Context

[ADR-0005](0005-meal-analysis-write-time-pipeline.md) 把餐食理解定为写时异步管道，但具体链路是
「视觉识别菜品 → 菜品分解 → 成分接地对照食物成分表 → 算热量 → 客户端人工确认」，并要求导入一张
中国食物成分表（`food_composition_items` 等三张表）来支撑计算。实测这条链在真实照片上行不通：

- **误差逐段放大**：菜品识别与成分接地的偏差会在「对照成分表算热量」这一步被放大成没有意义的数字；
  维护一张能覆盖真实饮食的成分表/模板库本身也是不可持续的成本。
- **失败被伪装成成功**：模型坏 JSON 被降级成「空识别结果」，写成 `unconfirmed + coverage: 'none'`，
  用户永远停在「估算中」，永不失败。
- **挂起会堵队列**：LLM 调用无 catch、无 timeout，重试耗尽后记录永久 `analyzing`（concurrency=1 时
  一次挂起堵整条队列）；幂等又只在调用前检查，分析期间用户再编辑会被旧结果覆盖。
- **状态由客户端决定**：`confirmed` 由客户端 payload 决定，可对空分析/旧 revision 直接确认，并触发模板学习。
- **下游从文本猜语义**：建议引擎靠 title/note 关键词猜咖啡因摄入（与已删除的症状严重度启发式同病）。
- **伪精确**：多模态模型直接估营养的准确度有限、份量最不准，单值热量会给出虚假的确定性。

同时，ADR-0005 的读侧约定（`confirmed` / `unconfirmed` / `coverage` 矩阵）在删除人工确认后已无处安放。

## Decision

1. **一次多模态调用直出结构化结论**：输入图片（+ 餐次/时间上下文），用结构化输出（JSON Schema +
   strict function calling，20s 超时）返回 `{ calorieRange, dishes, items, facets }`，落库前再过一遍
   服务端 schema 与规范化。**失败必须上抛/落库为失败**，不再有「空结果＝成功」。
2. **热量只给区间与档位**：`calorieRange = { min, max, unit: 'kcal', bucket: low|medium|high }`，
   服务端纠正 `min<=max`、clamp、按中位值推导 `bucket`，UI 不显示单值。模型顺带产出的热量文案属于 `items`。
3. **`items` 是「按重要性排序的结论」**：`{ rank(从 1 连续), kind(封闭词表), polarity(good|watch|neutral),
headline(≤18 字，列表条目那一行), detail(一句话，详情/助手用) }`，服务端重排、去空、封顶 5 条。
4. **`facets` 是机器语义的唯一来源**：封闭词表按维度给 `low|ok|high`。规则、聚合、图表读它，
   **不再从 `title`/`value`/`note` 或文案里猜**。模型生成的 `headline`/`detail` 按分析当时的语言生成并存
   `locale`，不回溯重生成（结构化字段不受语言影响）。
5. **状态收敛为三个终态**：`analyzing | analyzed | analysis_failed` + 稳定 `failureReason` 码；
   删除人工确认、`confirmed`/`unconfirmed`、`coverage` 与模板学习。写回前复检 `sourceRevision`；
   `analyzing` 有 10 分钟过期回收；详情页对 `analysis_failed` 提供「重新分析」（重新入队 + revision 递增）。
6. **读路径分两层**：列表/聚合/助手只读投影列（`meal_analysis_status` / `meal_headline` /
   `meal_calorie_min|max|bucket` / `meal_analysis_failure_reason`，跨模块读模型 `DailyRecordFact`
   同样携带），详情接口与需要 `items`/`dishes` 明细的消费方才回读 `payload.mealAnalysis`。
7. **删除对照成分表那条链**：`meal-dish/decomposition`、`meal-ingredient/grounding`、
   `meal-analysis/matcher`、`template-learning` 与食物成分表在餐食链路上的使用一并去掉
   （重复餐食的成本由「每餐一次多模态调用」本身承担）。产品未上线：不做数据迁移、不留兼容读取。
8. **助手不重复识图**：`get_meal_analysis_digest` 返回已算好的 `{date, title, calorieRange, items, dishes}`
   窗口读，`days`/`limit` 由模型通过工具参数给出，服务端封顶最近 15 天、最多 20 餐。

### 读侧约定 v2（Today / Report / Assistant / 建议规则）

- `analyzing`：Today 只显示记录本身、不作餐食结论；Report 不计入分析天数；Assistant 视为不可用；
  建议规则不消费。
- `analyzed`：`items` 与区间可按区间引用；Report 计入 `analyzedDays`；Assistant 用 digest 引用。
- `analysis_failed`：Today/Assistant 明确说「分析失败/不可用」而不是静默省略；Report 计入 `failedDays`
  且不参与任何营养结论；详情页给「重新分析」。
- 任何消费方都不得由餐食数据下诊断、处方或用药判断；热量只能以区间/档位表述。

## Options Considered

| Option                                                             | Pros                                                                             | Cons                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 一次多模态直出（本方案）                                           | 每餐一次调用，成本与尾延迟都更低；结论与区间是结构化一等公民；失败可重试、可审计 | 依赖模型输出质量，需要 schema + 服务端规范化兜底；不给单值热量，用户看不到「精确数字」 |
| 修好 ADR-0005 的旧链路（补 timeout、修 JSON 降级、服务端校验确认） | 改动小、保留成分表口径                                                           | 误差放大与成分表维护成本没有解决；下游仍要解析多段结构；模板学习仍依赖人工确认         |
| 模型直出宏量营养素克数                                             | 「更专业」的观感                                                                 | 直接估克数的误差最大，会重新引入伪精确；营养学上也没有可靠接地                         |
| 读时按需分析（助手每次联网分析图片）                               | 无需落库状态机                                                                   | 读路径不一致、成本高、无法解释为何结论缺失，ADR-0005 已否决                            |

## Consequences

- **契约**：payload 只有 `mealAnalysis` 一个键（`version: 2`）。客户端唯一可编辑的是菜名列表
  （`{ mealAnalysis: { dishes: [{ name }] } }`，整份标记 `source: 'user'`），改菜名**不重算**结论与区间；
  其余字段客户端提交一律忽略。
- **模型漂移被限制在文案层**：`kind`/`polarity` 非法回落、`rank` 重排、区间纠正、`facets` 过滤未知键；
  结构化字段稳定，文案可再渲染。
- **文案语言**：按分析当时语言生成并存 `locale`，切语言不回溯重生成，也不提供重生成入口。
- **下游口径统一**：today-suggestion 的饮食信号改读 `facets`（`diet_facets` → `diet_imbalance` 规则），
  reports 用 `analyzedDays | analyzingDays | failedDays`，today-analysis 用「菜名 + 区间 + 前两条结论」。
- **遗留**：`food_composition_items` / `meal_dish_templates` / `meal_dish_template_ingredients` 三张表
  及其导入脚本在删除链路后已无消费方，删表与否单独立项（见 `docs/TODO.md`）。
- **回溯成本**：若将来需要成分级明细（宏量营养素克数），应按「模型直出 + 明确标注为估算」重做，
  而不是回到成分表接地。

## Relationship to ADR-0005

ADR-0005 的**写时异步管道形态保留**（图片写入触发、结果落库、下游共读同一份 server-owned 结果、
作业按 `recordId:sourceRevision` 键控以防陈旧写回）。被本 ADR 取代的是它的具体链路与读侧约定：成分表导入与接地、
`mealInput` 客户端自由 payload、`confirmed`/`unconfirmed` 与 `coverage` 状态、以及基于它们的共享读规则矩阵。
ADR-0005 按只增不改的约定保留原文，历史上限以其落笔时的设计为准。
