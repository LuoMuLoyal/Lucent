# Lucent E2E 测试缺口审查与补充计划

> 创建日期：2026-07-10
> 范围：`Lucent/src` 全部 Controller 端点 vs `Lucent/test/e2e` 已有覆盖

## 一、审查方法

1. 枚举 `src/modules/**/*.controller.ts` + `src/app.controller.ts`，提取每个 `@Get/@Post/@Patch/@Delete/@Put` 端点
2. 逐个读取 19 个 `test/e2e/**/*.e2e-spec.ts` 文件，提取实际调用的路径与断言
3. 按"端点被至少一次有效 `supertest` 调用 + 非纯 401 断言"判定为已覆盖
4. 仅测了 401 或仅容错路径（`not.toBe(401)`）判定为部分覆盖

## 二、全局统计

| 维度                          | 数量                             |
| ----------------------------- | -------------------------------- |
| Controller 文件               | 22                               |
| 总端点数                      | ~80                              |
| E2E 测试文件                  | 19                               |
| 完全无 E2E 覆盖的端点         | ~28                              |
| 部分覆盖（仅 401 / 容错路径） | ~12                              |
| 模块覆盖率 0%                 | Auth(OAuth), Reminder Deliveries |

## 三、缺口明细

### 按优先级分级

- 🔴 P0 — 核心业务路径，用户直接交互
- 🟡 P1 — 辅助功能或已有间接覆盖
- ⚪ P2 — SSE 流式 / OAuth 第三方回调（测试环境难以完整覆盖）

### 🔴 P0 高优先级

| #   | 模块                | 端点                                                    | 说明                        |
| --- | ------------------- | ------------------------------------------------------- | --------------------------- |
| 1   | Account             | `POST /account/set-password`                            | OAuth-only 用户首次设置密码 |
| 2   | Account             | `POST /account/identities/wechat-web/authorize`         | 创建微信关联授权 URL        |
| 3   | Account             | `POST /account/identities/wechat-web/callback`          | 微信网页身份关联            |
| 4   | Account             | `POST /account/identities/wechat-mobile/callback`       | 微信移动端身份关联          |
| 5   | User Settings       | `POST /settings/security-pin`                           | 启用安全 PIN                |
| 6   | User Settings       | `POST /settings/security-pin/verify`                    | 验证 PIN 获取提权令牌       |
| 7   | User Settings       | `POST /settings/security-pin/change`                    | 更改 PIN                    |
| 8   | User Settings       | `POST /settings/security-pin/disable`                   | 禁用 PIN                    |
| 9   | Notifications       | `GET /notifications/:id`                                | 通知详情                    |
| 10  | Notifications       | `PATCH /notifications/:id/read`                         | 标记已读                    |
| 11  | Notifications       | `PATCH /notifications/:id/unread`                       | 标记未读                    |
| 12  | Notifications       | `DELETE /notifications/:id`                             | 删除通知                    |
| 13  | Reports             | `POST /reports/clinic-summary/preview`                  | 就诊摘要预览                |
| 14  | Reports             | `POST /reports/clinic-summary/share`                    | 创建分享链接                |
| 15  | Reports             | `GET /reports/clinic-summary/shared/:token`             | 公开访问分享摘要            |
| 16  | Reports             | `GET /reports/clinic-summary/preview/pdf`               | 下载摘要 PDF                |
| 17  | Reports             | `GET /reports/clinic-summary/shared/:token/pdf`         | 下载分享摘要 PDF            |
| 18  | Medicines           | `GET /medicines/safety-tips`                            | 用药安全提示                |
| 19  | Medicines           | `POST /medicines/recognize`                             | AI 药盒识别                 |
| 20  | Reminder Deliveries | `GET /reminder-deliveries`                              | 投递审计日志                |
| 21  | Assistant           | `POST /assistant/conversations/:conversationId/open`    | 激活历史会话                |
| 22  | Assistant           | `POST /assistant/latest/clear`                          | 归档当前会话                |
| 23  | Assistant           | `POST /assistant/messages/stream`                       | SSE 流式对话                |
| 24  | Daily Records       | `POST /daily-records/attachments/images/presign-upload` | 图片预签名上传              |

### 🟡 P1 中优先级

| #   | 模块           | 端点                                    | 说明                 |
| --- | -------------- | --------------------------------------- | -------------------- |
| 25  | Session        | `GET /auth/sessions`                    | 列出活跃会话         |
| 26  | Session        | `DELETE /auth/sessions/:sessionId`      | 撤销指定会话         |
| 27  | Health         | `GET /health/live`                      | Liveness 探针        |
| 28  | Health         | `GET /health/deep`                      | 深度健康检查         |
| 29  | Today Analysis | `POST /today-analysis/generate`         | 生成今日 AI 分析     |
| 30  | Today Analysis | `POST /today-analysis/generate/stream`  | SSE 流式生成         |
| 31  | Reports        | `POST /reports/summary/generate/stream` | SSE 流式生成报告摘要 |

### ⚪ P2 低优先级

| #     | 模块         | 端点                | 说明                             |
| ----- | ------------ | ------------------- | -------------------------------- |
| 32-38 | Auth (OAuth) | 7 个 OAuth 回调端点 | 需要真实第三方服务，难以完整模拟 |

## 四、模块覆盖矩阵

| 模块                | 总端点 | 已覆盖 | 未覆盖 | 缺口率 |
| ------------------- | ------ | ------ | ------ | ------ |
| Health              | 4      | 2      | 2      | 50%    |
| Auth (Local)        | 6      | 6      | 0      | 0%     |
| Auth (Session)      | 4      | 2      | 2      | 50%    |
| Auth (OAuth)        | 7      | 0      | 7      | 100%   |
| Account             | 10     | 6      | 4      | 40%    |
| User Settings       | 6      | 2      | 4      | 67%    |
| Health Context      | 11     | 11     | 0      | 0%     |
| Daily Records       | 8      | 7      | 1      | 12%    |
| Today Suggestion    | 4      | 4      | 0      | 0%     |
| Today Analysis      | 3      | 1      | 2      | 67%    |
| Medicines           | 4      | 2      | 2      | 50%    |
| Medicine Reminders  | 4      | 4      | 0      | 0%     |
| Reminder Deliveries | 1      | 0      | 1      | 100%   |
| Medicine Dose Logs  | 5      | 5      | 0      | 0%     |
| Notifications       | 8      | 4      | 4      | 50%    |
| Files               | 1      | 1      | 0      | 0%     |
| Environment         | 1      | 1      | 0      | 0%     |
| Data Export         | 2      | 2      | 0      | 0%     |
| Reports             | 8      | 2      | 6      | 75%    |
| Assistant           | 6      | 3      | 3      | 50%    |
| Support Resources   | 2      | 2      | 0      | 0%     |
| Testing Support     | 1      | 1      | 0      | 0%     |

## 五、后续批次

继续按 P0 剩余项推进：

- Reports clinic-summary 子功能
- Medicines safety-tips + recognize
- Reminder Deliveries
- Assistant 会话操作
