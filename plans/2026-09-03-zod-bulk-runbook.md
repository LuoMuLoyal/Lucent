# Runbook: zod 批量迁移(请求侧)——子 agent 并行执行契约

Created: 2026-09-03 · Owner: backend · 配套计划: `2026-09-01-nestjs12-upgrade-plan.md`(执行完毕随计划删除)

## 用途与边界

供多个子 agent **并行、互不重叠**地把剩余"请求侧 DTO → zod"迁移做完。每个 agent 领一个或多个模块
批次,按本手册执行并跑通闸门。**本手册只覆盖请求侧**;纯响应/文档 DTO、响应侧序列化试点、errorCode
ADR、class-validator/class-transformer 依赖移除与全局管道收尾是独立步骤,不在此列。

### 验证结论(2026-09-03 已实测,直接采信)

- `@nestjs/common@12.0.1` 提供 `StandardSchemaValidationPipe`(消费参数 `{ schema }` 元数据)与
  `StandardSchemaSerializerInterceptor`;参数装饰器支持 `@Body/@Query/@Param({ schema, pipes })`。
- `setup-app.ts` 已全局注册 `new StandardSchemaValidationPipe()`(排在 ValidationPipe 之后,无 schema
  参数时 no-op),**各批次不需要再改全局管道**。
- OpenAPI **zod 直出零配置成立**:Swagger 从参数 schema 元数据自动生成 query 参数(类型/min/max/
  description);requestBody 预期同机制,**首个 body 批次需实证并回填本手册**。
- zod 400 实测返回 RFC9457 Problem Details:
  `{"code":"VALIDATION_FAILED","title":"Validation failed","detail":"…","errors":{"general":["lat: lat must be a number"]},"retryable":false}`。
- 语义差异口径(environment 模板已验证):空串数值按 `Number('')===0` 接受;非法数字 400;未知键默认
  strip,**原 forbidNonWhitelisted 语义按端点需要显式 `.strict()`**。

## 迁移规则(必须逐条遵守)

1. 文件内一次性切换:请求 DTO 文件删去 `class-validator`/`class-transformer`/`@nestjs/swagger` 的
   `@Is*`/`@Type`/`@Transform`/`@ApiProperty*`,改为 `z.object({...})` 导出 `xxxSchema` +
   `export type XxxDto = z.infer<typeof xxxSchema>`;**类名保留为类型名**,形状不变。
2. 装饰器映射:
   - `@IsString`→`z.string()`;`@IsOptional`→`.optional()`;`@IsEmail`→`z.email()`;`@IsInt`→`z.number().int()`;
     `@IsNumber`→`z.number()`;`@IsBoolean`→`z.boolean()`;`@IsDateString`→`z.iso.datetime()`(以 zod v4 原生
     为准并 e2e 验证);`@Min/@Max/@Length/@MaxLength`→`.min/.max/.min(..).max(..)`。
   - `@Type(() => Number)`+数值→`z.coerce.number()`;`@Type(() => Boolean)`→`z.coerce.boolean()`(query
     布尔语义需 e2e 验证并回填);字符串保持 `z.string()`(body 已是非字符串时同)。
   - `@IsEnum(E)`→`z.enum(数组常量)` 或 `z.nativeEnum(E)`;数组:zod v4 用 `z.array(元素).max(n)`(写
     法注意 v4 无 `.max`? 用 `.length`/自定义 refine 时按实测,并在 e2e 覆盖)。
   - `@ValidateNested`+`@Type(() => X)`→ 子 schema 引用;数组默认值/空数组语义差异进 e2e。
   - `@Transform`(medicines/query.dto.ts 唯一)→ 用 zod transform/preprocess,先读原实现再等价迁移。
   - 未知键:默认 strip;若原端点吃 forbidNonWhitelisted 且需要拒绝,加 `.strict()`。
   - `@ApiProperty` 的 description/example:`description` 用 `.describe(...)` 保留(仅文档),
     **example 本阶段不强求**(zod 无原生 example,补全走 TODO「OpenAPI example/nullable 元数据」)。
3. 控制器:该 DTO 对应的参数改用
   `@Body({ schema: xxxSchema })/@Query({ schema: xxxSchema })/@Param({ schema: xxxSchema })`(type 标注
   用 `z.infer` 类型)。**删除重复的手工 `@ApiQuery`** 等已由 schema 直出的文档装饰器。响应侧 DTO
   (仅 `@ApiProperty`)与 `@ApiResponse({type})` **保持不动**。
4. 共享/复用:DTO 常量数组、枚举保持导出;若其他文件 import 该 DTO 名,改为 `import type`(或自动
   elide);**禁止** `new XxxDto()`(见「值实例化清单」替换为类型化字面量)。
5. 自定义复合验证器(auth 的 `@IsStrongPassword` 等,定义于 `src/common/validators/`):在该批内用
   zod `.refine`/`z.string().regex` 等价落地,规则常量引用原实现;**auth 批同时改写**
   `src/common/validators/auth.decorators.spec.ts` 相关用例为 schema 断言。
6. 语义差异用例入 e2e(每批至少:合法通过、格式错误 400 且 `code=VALIDATION_FAILED`、coerce 边界
   (数字字符串/空串/数组)、unknown-key 行为)。
7. **不改 lint/tsconfig/规则;不格式化无关文件;不重构周边代码。**

## 值实例化清单(需替换为类型化字面量或 `schema.parse`)

- `src/modules/health-events/health-events.controller.ts`:`new EventListQueryDto()`
- `src/modules/reports/reports.controller.ts`:`new EventReviewListQueryDto()`
- spec 内 `new X()`(随所在模块批改):health-events(create/end/event-list-query/upsert-check-in)、
  medicine-reminders(reminder-delivery-receipt)、product-events(create/batch/funnel-query)。

## 模块批次清单(每批完成后提交;命名顺序建议从简到繁)

| 批  | 模块                     | 请求 DTO(相对 src/modules)                                                      | 备注                                              |
| --- | ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | environment ✅           | dto/snapshot-query.dto.ts                                                       | 已完成(模板)                                      |
| 2   | legal-documents          | dto/query.dto.ts                                                                | Query2+Param1                                     |
| 3   | files                    | dto/create-file-upload.dto.ts                                                   | multipart,Body1                                   |
| 4   | user-settings            | dto/update.dto.ts                                                               | Body1                                             |
| 5   | notification-preferences | dto/update.dto.ts                                                               | Body1                                             |
| 6   | data-export              | dto/export-response.dto.ts                                                      | 名称含 response 但带校验,先核使用                 |
| 7   | product-events           | dto/create-product-event.dto.ts, dto/funnel-query.dto.ts                        | 含数组/嵌套;spec `new` 用例                       |
| 8   | assistant                | dto/confirm-proposal.dto.ts, rename-conversation.dto.ts, stream-messages.dto.ts | Body+Param                                        |
| 9   | medicine-dose-logs       | create/update/mark-dose-log 3 文件                                              | 42 校验器                                         |
| 10  | today-analysis           | generate-today-analysis.dto.ts                                                  | Body/Query                                        |
| 11  | today-suggestion         | feedback.dto.ts                                                                 | Query+Param+Body                                  |
| 12  | account                  | unlink-identity.dto.ts, update.dto.ts                                           | Body9                                             |
| 13  | daily-records            | candidates 2 + create/update/query/attachment 4 = 6                             | 大;候选生成/图片上传嵌套                          |
| 14  | health-events            | 4 文件                                                                          | `new` 在控制器与 spec;含数组嵌套                  |
| 15  | reports                  | 4 文件                                                                          | `new EventReviewListQueryDto`                     |
| 16  | medicines                | query(含 @Transform)/recognize/risk-check-request                               | query 唯一 @Transform 迁移模板                    |
| 17  | medicine-reminders       | 5 文件                                                                          | 66 校验器;reminder-delivery-receipt spec `new`    |
| 18  | user-health-context      | 7 文件                                                                          | 100 校验器;8 Body+6 Param                         |
| 19  | auth                     | 13 文件                                                                         | 自定义复合验证器 port;common/validators spec 改写 |
| 20  | testing-support          | prepare-fullstack-record-lane.dto.ts                                            | 仅供测试支撑                                      |

## 每批执行步骤与闸门

1. 按上表替换 DTO→zod、改控制器、清 spec `new`/类型导入。
2. `pnpm typecheck` 该批零错(全仓 tsc 亦应零错,跨批并行时以各自模块先行)。
3. 该模块 unit spec 与 e2e(含新增语义用例)绿。
4. `pnpm export:openapi` → `git diff docs/reference/generated/openapi.json` 审查:仅本批涉及
   operation/schema 变化;逐条确认无意外漂移。
5. 合同联动(硬流程):`openapi.json` 变更在批内单独成 commit;结构性变更需在 Luminous 执行
   `dart run scripts/contract/bootstrap.dart` + `flutter analyze/test`(先修 TODO「Luminous bootstrap
   流水线修复」;纯 description/example 漂移可跳过并注明)。
6. 迁移日志(当日文件)追加批次条目;提交信息描述本批变更(不带内部代号、不写"XX 文件"类模糊计数,
   点名模块与范围)。

## 边界与后续(本手册不处理)

- 45 个纯响应/文档 DTO + 3 个 typeonly 文件:不动,等响应侧序列化试点决策。
- 全局 `ValidationPipe`→`StandardSchemaValidationPipe` 收尾、class-validator/class-transformer 依赖
  移除、`formatValidationErrors` 退役:全部模块完成后单独执行(先查 adminjs/prisma 间接引用)。
- errorCode ADR、OpenAPI example/nullable 元数据补全、Luminous bootstrap 流水线修复:见 docs/TODO.md。

## 附录:环境与探针证据(2026-09-03)

- `pnpm check`/全量 e2e 30 文件 447 例(environment 3 新例在内);typecheck/eslint/format 绿。
- 上述 zod 400 body、OpenAPI 自动 query 生成、`.strict()` 拒绝未知键均来自真实 e2e/export 复现。
