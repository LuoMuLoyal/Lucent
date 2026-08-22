# Better Auth 替代 Lucent 手写 auth 的可行性调研

## 结论摘要

结论：**Better Auth 可以替代 Lucent 的一部分通用认证基础设施，但目前不能作为 Lucent 现有 auth 模块的直接、无适配替换。**更准确的定位是：可评估为认证内核，外面仍需保留 Lucent 的 API 适配层、部分 OAuth provider 适配、业务账户逻辑，以及 JWT access/refresh 合同或其兼容实现。

主要原因：

1. Better Auth 默认提供的是服务端 session + cookie；其 JWT 插件提供从现有 session 获取 JWT、JWKS 验证和若干签名能力，官方明确说它不是 session 的替代品。检查到的官方 JWT endpoint/source 没有 Lucent 当前这种 access token + refresh token 轮换接口。[S2][S10][S11]
2. Better Auth 默认使用 scrypt，而不是 Argon2；但 email/password 配置提供 `password.hash` 和 `password.verify`，官方文档给出了 Argon2id 自定义实现方式，因此 Lucent 的 Argon2id 要求原则上可保留。[S1][S9]
3. Better Auth 的 credential password 存在 `account` 表，provider 为 credential；Lucent 当前密码哈希在 `users.password_hash`。这不是只改 controller 的迁移，需要 schema 映射、数据迁移和兼容验证。[S1][S5][L1][L2]
4. 2FA 插件支持 TOTP、OTP、backup codes、trusted devices 和锁定；passkey 是另一个 WebAuthn/FIDO2 插件。Lucent 当前的 Security PIN 是“敏感操作前的安全提升”，不等同于 Better Auth 的登录二次因子。[S3][S4][L3]
5. Prisma 7 在官方 peer metadata 中受支持，官方 Prisma 文档也有 Prisma 7 说明；但 Prisma adapter 的 schema 生成和迁移仍需接入 Lucent 现有多文件 schema 与表结构。[S6][S7][S8]
6. 官方提供 Fastify 集成；本次直接 HTTP GET 检查的 NestJS URL 返回 404，未确认存在官方 Nest adapter 或 Nest 专用集成文档。Nest + Fastify 可以通过 `auth.handler` 和 Node headers helper 手动接入，但这属于适配代码。[S12][S13][S14]

因此建议：**暂不直接替换现有 auth；若要推进，先做隔离的 Better Auth spike，优先验证 Prisma schema、既有用户迁移、JWT 外部合同和 Flutter 客户端 cookie/token 行为。**

## 调研范围与版本锁定

- 访问日期：2026-08-22（Asia/Shanghai）。
- Better Auth 官方文档版本选择器：`v1.7 (Latest)`；文档页面实际 canonical host 为 `better-auth.com`。
- npm 官方 registry 的 `better-auth` `latest`：`1.7.1`。
- GitHub 官方源码核对：`v1.7.1` tag；远端 `refs/tags/v1.7.1` 返回 `2344536054f9164ca5d1670c270d299049ee233e`。源码链接均固定到该 tag；没有把 `main` 的未发布变化当成已发布行为。
- npm 元数据还显示 `@better-auth/prisma-adapter@1.7.1` 和 `@better-auth/passkey@1.7.1`。

## 逐项事实核对

### 1. Argon2 与密码哈希

| 事实                                                                                                                                                                              | 对 Lucent 的含义                                                                                             | 官方来源 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| Better Auth email/password 默认使用 scrypt；官方说明选择 scrypt 是因为 Node.js 原生支持，并提到 OWASP 在 Argon2id 不可用时推荐 scrypt。                                           | 不能把“默认支持 Better Auth”表述成“默认使用 Argon2”。Lucent 当前 Argon2id 需要显式配置。                     | [S1]     |
| `emailAndPassword.password` 可配置 `hash(password)` 与 `verify({ hash, password })`。                                                                                             | Lucent 可将现有 Argon2id 参数封装成 Better Auth 的 hash/verify 回调。                                        | [S1][S9] |
| 官方文档给出的自定义示例使用 `@node-rs/argon2`，并将 `algorithm: 2` 标为 Argon2id。                                                                                               | 官方确认了“接入 Argon2id 的配置形状”，但没有确认 Lucent 当前 `argon2` npm 包的哈希字符串可直接被该示例验证。 | [S1]     |
| v1.7.1 源码的 `crypto/password.ts` 只是导出 `@better-auth/utils/password` 的默认实现；文件注释明确 Node/Bun/Deno 使用 Node crypto scrypt，其他运行时使用 `@noble/hashes` scrypt。 | 默认实现事实由源码再次确认；Argon2 只能走配置回调。                                                          | [S9]     |

Lucent 当前代码使用 `argon2.hash/verify` 和 `ARGON2_OPTIONS`，数据库字段是 `User.passwordHash`。[L1][L2] 迁移时不能只替换验证函数，还必须决定 credential account 的存储位置及既有哈希如何迁移。

### 2. JWT access/refresh 插件及限制

| 事实                                                                                                                                                                                                                        | 对 Lucent 的含义                                                                                                           | 官方来源   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| JWT 插件文档将其定位为：为不能使用 session 的服务提供 JWT；并明确说它不是 session 的替代品。若目标只是让 API 使用 Authorization bearer header，文档引导查看 Bearer plugin。                                                 | 不能把它直接等同于 Lucent 当前的 access/refresh session 模型。                                                             | [S2]       |
| Bearer 插件接收 Authorization bearer token，并将 Better Auth 的 session token 转换为 session cookie；源码默认用 Better Auth secret 校验签名，或在非签名模式下包装 token。它不是 JWT 签发器，也没有 access/refresh pair。    | 可以适配“用 bearer header 携带 Better Auth session token”，但不能满足 Lucent 对 JWT、refresh hash 和 rotation 的合同要求。 | [S20][S21] |
| `/token` endpoint 要求现有 session，通过当前 session 生成 JWT；`getSession` 还可以在 `set-auth-jwt` response header 暴露 JWT。                                                                                              | JWT 是从 Better Auth session 派生的服务令牌，不是独立的 refresh-token 登录体系。                                           | [S2][S10]  |
| `/jwks` 提供公钥；官方说明外部服务可以本地用 JWKS 验证，无需额外 verify 请求或数据库查询。默认 JWT expiration 为 15 分钟。                                                                                                  | 适合服务到服务的短期 bearer JWT；可满足部分外部验证需求。                                                                  | [S2]       |
| 主 `session_token` cookie 是不透明的服务端 session 标识，不通过 JWKS 暴露；JWT plugin 的 `/token` JWT 与 session cookie cache JWT 也不是可互换 token。                                                                      | 不能简单地把 Better Auth 的 cookie cache JWT 当成 Lucent access token。                                                    | [S2][S5]   |
| session cookie cache 的 `strategy: "jwt"` 默认使用 HS256；只有另行启用 `jwt({ sessionCookieCache: true })` 才会使用 JWT plugin 的本地密钥。启用后仍只影响 `session_data` cookie。                                           | 需要明确区分 session cookie、cookie cache JWT 和 `/token` JWT 三种对象。                                                   | [S2][S5]   |
| v1.7.1 JWT plugin source 暴露的核心 endpoint 是 `getJwks`、`getToken`，另有 server-only 的 sign/verify；`getToken` 通过 `sessionMiddleware`。源码没有展示 access/refresh pair endpoint 或 refresh-token rotation endpoint。 | 在本次官方源码范围内，未找到可以直接替代 Lucent `POST /auth/refresh` 的 Better Auth JWT endpoint。                         | [S10]      |
| JWT plugin 支持自定义 issuer、audience、expiration、payload、算法、密钥轮换和自定义 adapter。                                                                                                                               | 如果保留 Lucent access token 合同，可复用/借鉴签名能力，但仍需要自己的 pair/refresh 适配层。                               | [S2][S11]  |

Lucent 当前 access JWT 使用 HS512、独立 access/refresh secret、数据库 refresh hash、单次 claim 后轮换；`POST /api/v1/auth/refresh` 是公开 endpoint。[L4] 这些语义不是 Better Auth JWT 文档默认行为，迁移时必须单独做合同兼容设计。

### 3. 2FA、TOTP、passkey 与其他二次因子

| 能力            | 官方事实                                                                                                                                                       | 对 Lucent 的含义                                                                                                | 官方来源   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| TOTP            | `twoFactor()` 支持 TOTP；启用时默认要先验证 enrollment code；默认周期 30 秒，验证接受前后一个时间周期。                                                        | 可以覆盖标准认证器 App 的二次验证。                                                                             | [S3]       |
| OTP             | 2FA 插件也支持 OTP；服务端必须提供 `otpOptions.sendOTP`，发送渠道由应用实现，可用于 email、phone 或其他应用支持的方式。                                        | 不是内置短信供应商；Lucent 需要继续负责邮件/短信投递与限流策略。                                                | [S3]       |
| Backup codes    | 插件生成并持久化 backup codes；已使用 code 会从数据库删除，不能重复使用。                                                                                      | 可覆盖账户恢复，但需要新增 plugin schema 和产品交互。                                                           | [S3]       |
| Trusted devices | TOTP/OTP/backup code 验证可传 `trustDevice`；官方文档写明默认信任 30 天，并在后续登录刷新。                                                                    | 与“记住设备”需求匹配，但与 Lucent 当前设备/session 列表仍需做 API 映射。                                        | [S3]       |
| 2FA 登录门槛    | 默认只对 credential sign-in（email、username、phone）执行 2FA；email OTP、magic link、OAuth/social、passkey、anonymous 等 passwordless 流程默认不被 2FA gate。 | 如果要求所有登录路径都完成二次因子，需要自定义 hook/流程；不能假设启用插件后所有 OAuth/passkey 登录自动受保护。 | [S3]       |
| Passkey         | `@better-auth/passkey` 基于 WebAuthn/FIDO2；支持注册、登录、列出和删除 passkey，且可配置 passkey-first 注册。                                                  | 可增加无密码/抗钓鱼登录；它不是 Lucent 当前 Security PIN 的替代物，也不是 2FA plugin 的同一配置项。             | [S4][S8]   |
| 其他插件        | 官方导航和基础用法还列出 email OTP、magic link、phone number 等插件/能力。                                                                                     | 可以扩展认证入口，但每个入口都要重新核对 API 合同、风控和 Flutter 客户端支持。                                  | [S15][S16] |

Lucent 当前已经把原有 2FA 表替换成 `security_pin_enabled`、`security_pin_hash` 和 `security_elevation_version`；Security PIN 用于敏感操作前签发短期 elevation JWT，不是登录时 TOTP/OTP 二次因子。[L3][L5] Better Auth 2FA plugin 可以补充登录二次认证，但不能无配置地替代这一业务安全提升机制。

### 4. Session、Account、OAuth、邮箱验证、密码重置

#### Session / Account 数据模型

官方 core schema 包含 `user`、`session`、`account`、`verification` 四类表：

- `session` 保存 token、userId、过期时间、userAgent 等；默认 session 7 天，并根据 `updateAge` 延长有效期。[S5]
- Better Auth 的默认 session 是 cookie-based，主 `session_token` 是服务端 session 标识；支持列出、撤销单个、撤销其他和撤销全部 session。[S5]
- `account` 表代表绑定到 user 的一种认证方法。官方列出 providerId、accountId、accessToken、refreshToken、scope、password 等字段；其中 credential password 也放在 account 表。[S5]
- `verification` 表用于验证请求的 identifier 和过期时间，适合邮箱验证、密码重置等短期 token。[S5]
- Account output 会过滤 access token、refresh token、id token 和 password 等敏感字段；这在 v1.7.1 core schema source 中有明确的输出过滤逻辑。[S17]

这与 Lucent 当前模型有实质差异：Lucent 使用 `User.passwordHash`、`UserIdentity` 表保存 OAuth 身份、`UserSession.refreshTokenHash` 保存 refresh token hash。[L1] 因此应按“新增/映射 Better Auth 表 + 用户和身份迁移”估算，而不是按“替换一组 Nest service”估算。

#### OAuth / Account

- Generic OAuth plugin 支持 OAuth 2.1 或 OIDC provider，provider 作为一等 social provider 注册；默认启用 PKCE 和 issuer validation。[S16]
- 对非标准 provider，官方提供 `getToken`、`getUserInfo`、`tokenUrlParams`、自定义 headers、显式 authorization/token/userInfo endpoint 等扩展点。[S16]
- 官方支持 `accessType: "offline"` 请求 provider refresh token，并可在 `accessTokenExpiresIn` 缺少 provider `expires_in` 时提供 fallback；provider token 的 refresh 是 OAuth account token 管理，不等于 Better Auth 的用户登录 access/refresh pair。[S16][S5]
- Generic OAuth 的 callback 默认是 `/callback/:providerId`，并要求 providerId 与配置匹配；显式 endpoint provider 不支持通过 discovery 的 id_token 直登路径。[S16]

对 Lucent：Apple 可以按官方 social provider 或 generic OAuth 处理；WeChat、QQ、Weibo 是否能直接使用 generic OAuth，官方资料没有针对 Lucent 所用移动/Web 变体给出保证。若 token exchange 或用户资料接口非标准，理论上有 `getToken`/`getUserInfo` 扩展点，但仍需逐 provider 实测并保留 Lucent 的 unionId、身份合并、防账号接管规则。[S16][L6]

#### 邮箱验证

- email/password 配置可提供 `emailVerification.sendVerificationEmail`；回调收到 user、url、token，由应用发送邮件。[S1]
- `requireEmailVerification: true` 可要求用户验证邮箱后才允许 email/password 登录；官方还描述了枚举保护行为。[S1]
- `sendOnSignIn`、`autoSignInAfterVerification`、token `expiresIn` 等配置在官方 core option type 中存在；默认验证 token 有效期为 3600 秒。[S9]

Lucent 当前通过验证码服务 + 邮件服务实现注册、登录/邮箱验证和限流；Better Auth 能接管“验证 token + endpoint”，但投递、业务化文案、Redis 限流、响应 envelope 仍需适配。[L2][L6]

#### 密码重置与改密

- 配置 `sendResetPassword` 后可发送密码重置 URL/token；官方 core option type 的默认 reset token 有效期为 1 小时。[S1][S9]
- `revokeSessionsOnPasswordReset` 存在且默认 false；Lucent 当前改密和重置密码都会撤销用户全部 session，因此迁移时必须显式设为 true 或用 hook 保持该语义。[S1][S9][L2]
- Better Auth 文档还提供 `changePassword`；当前密码和新密码由 Better Auth endpoint 处理。[S1]

### 5. Prisma 7

官方证据支持“Prisma 7 可用”，但不等于“可以直接套入 Lucent schema”：

- `better-auth@1.7.1` 的 npm peerDependencies 包含 `prisma` 和 `@prisma/client` 的 `^7.0.0`。[S6]
- `@better-auth/prisma-adapter@1.7.1` 自身也声明 `prisma`、`@prisma/client`、`@better-auth/core` 和 `@better-auth/utils` peer dependencies，其中 Prisma/client 包含 `^7.0.0`。[S7]
- 官方 Prisma adapter 文档要求安装 `@better-auth/prisma-adapter`，并说明 Prisma 7 从 `schema.prisma` 的 custom output path 导入对应生成的 Prisma client；文档示例本身使用 `@prisma/client`。[S8]
- 官方 database 文档说明：对 Prisma/Drizzle 使用 `generate` 生成 ORM schema，再由对应 ORM 负责迁移；CLI 的 `migrate` 是内置 Kysely adapter 的路径，不能据此假设 Better Auth 会替 Lucent 的 Prisma migration 管理。[S5][S8]
- Prisma adapter source 以传入的 Prisma client model delegate 实现 Better Auth adapter；它并不自动理解 Lucent 的 `UserIdentity`、软删除约定、`passwordHash` 语义或现有 refresh session 语义。[S18]

Lucent 当前为 Prisma 7、多文件 schema、custom generated client path，并且领域表直接依赖 `User`。可行路线是显式映射 Better Auth 的 user/session/account/verification 表名和字段，或把 Better Auth auth tables 与 Lucent domain user 通过稳定 ID 关联；两者都需要 migration、生成 schema、数据迁移和集成测试。[L1][S5][S8]

### 6. Nest / Fastify 集成

- 官方 Fastify 集成要求注册 `GET`/`POST` catch-all route（示例为 `/api/auth/*`），将 Fastify request headers 转为标准 `Headers`，构造 Fetch-compatible `Request`，调用 `auth.handler(req)`，再把 `Response` status/headers/body 转回 Fastify reply。[S13]
- 官方 Fastify 集成还提供 `fromNodeHeaders(request.headers)` + `auth.api.getSession({ headers })` 的服务端 session 读取方式，并要求正确配置 trusted origins 和 CORS。[S13]
- Basic Usage 说明 server-side 认证使用 `auth.api`，需要把请求 headers 传给 `getSession`；如果框架不能直接返回 Response，需要手动解析并设置 cookies。[S15]
- 本次直接 HTTP GET 访问 `https://better-auth.com/docs/integrations/nest-js` 返回 404；浏览器文档壳在该路径显示了 Fastify guide fallback，但这不能作为 Nest 支持声明。GitHub v1.7.1 `packages/` 官方目录也没有 Nest package。[S12][S19]

对 Lucent：由于 Lucent 是 NestJS 运行在 Fastify adapter 上，技术上可以把官方 Fastify handler 包进 Nest catch-all controller/route，再把标准 Response 转回 Fastify/Nest。但这不是已确认的官方 Nest adapter，且需要处理：Lucent `{ code, message, data }` envelope、`@Public()` 与现有 JWT guard、OpenAPI、i18n、审计、请求上下文、CORS/trusted origins，以及客户端当前发送 bearer token 的方式。[L7][S13][S15]

## 不能确认的点

以下内容在本次限定的一手资料范围内没有得到足够证据，不能写成已支持事实：

1. **Lucent 现有 Argon2 hash 的直接兼容性。** 官方确认可以注入 Argon2 hash/verify 回调，但没有确认 `argon2` npm 包生成的现有 PHC 字符串、参数和 Better Auth account 迁移后的读取路径可以零迁移直接工作。[S1][S9]
2. **Better Auth JWT/Bearer plugin 的 access/refresh pair 与 refresh rotation。** 官方 JWT 文档和 v1.7.1 source 核对到 `/token`、JWKS、sign/verify 及 session cookie cache 选项；Bearer 插件只把 bearer session token 转成 session cookie；没有找到 Lucent 所需的 pair endpoint、refresh token rotation 或 refresh-token hash 存储合同。[S2][S10][S20][S21][L4]
3. **WeChat/QQ/Weibo 的直接可用性。** Generic OAuth 给了非标准 token/profile 的扩展点，但没有针对 Lucent 的 Web/Mobile WeChat、QQ、Weibo 参数和返回结构提供官方保证。[S16][L6]
4. **官方 NestJS adapter。** 本次官方文档访问只确认 Fastify handler 方式；Nest URL 的直接 HTTP GET 返回 404，未确认 Nest 专用 adapter、Nest lifecycle 或 Nest response wrapper。[S12][S13][S19]
5. **Lucent 的 custom Prisma client/provider 组合。** 官方确认 Prisma 7 和 custom output path 的一般规则，但没有针对 Lucent 的 `prisma-client` generator、`generated/prisma/client` import、multi-file schema、软删除和已有领域 relation 做兼容测试。[S8][S18][L1]
6. **Flutter/Luminous 官方客户端支持。** 本次限定资料展示的是 Better Auth JavaScript client、浏览器 cookie 和 WebAuthn/Expo 等示例；未确认官方 Flutter/Dart client 或与 Luminous 当前 token 存储/刷新流程的直接适配。[S4][S13][S15]
7. **性能、迁移停机窗口和现有生产数据迁移风险。** 官方文档没有为 Lucent 的数据量、Redis/数据库拓扑或现有用户哈希给出保证，必须通过独立 spike 和备份恢复演练验证。

## 对 Lucent 的适配结论

### 可直接借用的能力

- email/password endpoint、邮箱验证、密码重置、改密和 session 管理的基础实现；Argon2 通过 `password.hash/verify` 自定义回调保留。[S1]
- Account/session/verification 的通用数据模型，以及 OAuth provider token 的存储模型。[S5]
- TOTP、OTP、backup codes、trusted devices 和 passkey；但应把 2FA 登录流与 Security PIN elevation 作为两个不同领域能力。[S3][S4][L3]
- Prisma 7 adapter 和 schema generate 路径。[S7][S8]
- 在 Fastify 上挂载 Better Auth handler 的底层机制。[S13]

### 必须保留或重写的适配层

- Lucent 当前 access/refresh API 合同、HS512/access-refresh secrets、refresh hash、单次 claim rotation 和 session 列表/撤销语义；Better Auth JWT/Bearer plugin 不能直接替代这些行为。[S2][S10][S20][S21][L4]
- Lucent 的 `{ code, message, data }` response envelope、i18n、DTO/OpenAPI、Nest guards/decorators、审计和限流。[L7]
- WeChat/QQ/Weibo 的 provider-specific OAuth 流程，除非逐 provider 证明 generic OAuth 的扩展点完全覆盖。[S16][L6]
- Security PIN、security elevation JWT 及其 version invalidation；Better Auth 2FA plugin 只能作为登录二次因子补充。[L3][L5]
- Lucent User 领域表与 Better Auth core schema 之间的映射/数据迁移；尤其是 `User.passwordHash` → credential `Account.password`。[S5][L1]

### 建议的验证顺序（不代表本次已实施）

1. 在隔离数据库中用 `better-auth@1.7.1`、`@better-auth/prisma-adapter@1.7.1` 和 Lucent 当前 Prisma 7 generated client 运行 `generate`，验证实际生成 schema 与 custom output。
2. 导入一组脱敏的现有用户，验证 Argon2id 既有哈希、邮箱已验证状态、OAuth identity、session 撤销和密码重置；不能只验证新注册用户。
3. 对比 Better Auth cookie session、Lucent bearer access token 和 Flutter 客户端的刷新行为；如果保留 Lucent API 合同，先做兼容 facade，不要先改客户端。
4. 分别验证 Apple、WeChat Web/Mobile、QQ、Weibo 的 callback、state/PKCE、profile unionId 和账号合并规则。
5. 明确是否要引入登录 2FA、继续保留 Security PIN，或两者并存；对 OAuth/passkey 是否强制二次因子写出单独安全决策。

## 官方来源登记

以下均为本次访问的一手来源；网页来源访问日期均为 2026-08-22，文档版本选择器为 `v1.7 (Latest)`；GitHub 源码固定到 `v1.7.1` tag；npm 来源为 npm registry 的 `latest` 元数据并返回版本 `1.7.1`。

| ID  | 官方来源                                                                                                                            | 版本/访问信息                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| S1  | [Email & Password](https://better-auth.com/docs/authentication/email-password)                                                      | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S2  | [JWT plugin](https://better-auth.com/docs/plugins/jwt)                                                                              | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S3  | [Two-Factor Authentication](https://better-auth.com/docs/plugins/2fa)                                                               | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S4  | [Passkey plugin](https://better-auth.com/docs/plugins/passkey)                                                                      | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S5  | [Database concept](https://better-auth.com/docs/concepts/database)                                                                  | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S6  | [npm `better-auth@latest` metadata](https://registry.npmjs.org/better-auth/latest)                                                  | registry returned `1.7.1`；访问 2026-08-22                                               |
| S7  | [npm `@better-auth/prisma-adapter@latest` metadata](https://registry.npmjs.org/@better-auth%2Fprisma-adapter/latest)                | registry returned `1.7.1`；访问 2026-08-22                                               |
| S8  | [Prisma adapter](https://better-auth.com/docs/adapters/prisma)                                                                      | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S9  | [Core password implementation](https://github.com/better-auth/better-auth/blob/v1.7.1/packages/better-auth/src/crypto/password.ts)  | GitHub tag `v1.7.1`；访问 2026-08-22                                                     |
| S10 | [JWT plugin source](https://github.com/better-auth/better-auth/blob/v1.7.1/packages/better-auth/src/plugins/jwt/index.ts)           | GitHub tag `v1.7.1`；访问 2026-08-22                                                     |
| S11 | [JWT plugin types](https://github.com/better-auth/better-auth/blob/v1.7.1/packages/better-auth/src/plugins/jwt/types.ts)            | GitHub tag `v1.7.1`；访问 2026-08-22                                                     |
| S12 | [NestJS integration URL checked](https://better-auth.com/docs/integrations/nest-js)                                                 | Accessed 2026-08-22; direct HTTP GET returned 404; browser shell showed Fastify fallback |
| S13 | [Fastify integration](https://better-auth.com/docs/integrations/fastify)                                                            | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S14 | [Better Auth Node helpers in source tree](https://github.com/better-auth/better-auth/tree/v1.7.1/packages/better-auth/src)          | GitHub tag `v1.7.1`；`fromNodeHeaders` usage documented by S13；访问 2026-08-22          |
| S15 | [Basic Usage](https://better-auth.com/docs/basic-usage)                                                                             | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S16 | [Generic OAuth plugin](https://better-auth.com/docs/plugins/generic-oauth)                                                          | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S17 | [Core schema output filtering source](https://github.com/better-auth/better-auth/blob/v1.7.1/packages/better-auth/src/db/schema.ts) | GitHub tag `v1.7.1`；访问 2026-08-22                                                     |
| S18 | [Prisma adapter source](https://github.com/better-auth/better-auth/blob/v1.7.1/packages/prisma-adapter/src/prisma-adapter.ts)       | GitHub tag `v1.7.1`；访问 2026-08-22                                                     |
| S19 | [Official repository packages tree](https://github.com/better-auth/better-auth/tree/v1.7.1/packages)                                | GitHub tag `v1.7.1`；访问 2026-08-22                                                     |
| S20 | [Bearer Token Authentication](https://better-auth.com/docs/plugins/bearer)                                                          | Better Auth docs `v1.7 Latest`；访问 2026-08-22                                          |
| S21 | [Bearer plugin source](https://github.com/better-auth/better-auth/blob/v1.7.1/packages/better-auth/src/plugins/bearer/index.ts)     | GitHub tag `v1.7.1`；源码行为核对；访问 2026-08-22                                       |

## Lucent 本地依据

| ID  | 文件                                                                                               | 用途                                                         |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| L1  | `src/modules/auth/services/identity/credential.service.ts`；`prisma/models/user.prisma`            | Argon2、email/password、验证、改密/重置、`User.passwordHash` |
| L2  | `src/modules/auth/services/identity/verification-code.service.ts`                                  | 验证码、邮件投递和限流                                       |
| L3  | `prisma/migrations/20260703125744_replace_two_factor_with_security_pin/migration.sql`              | Security PIN 替代旧 2FA                                      |
| L4  | `src/modules/auth/services/token.service.ts`；`src/modules/auth/controllers/session.controller.ts` | JWT access/refresh、refresh rotation、session API            |
| L5  | `src/modules/auth` security elevation implementation and architecture docs                         | Security PIN elevation JWT 与 version invalidation           |
| L6  | `src/modules/auth/providers/`；`src/modules/auth/services/oauth/`                                  | Apple、WeChat、QQ、Weibo 及 OAuth facade                     |
| L7  | `AGENTS.md`；`README.md`；`src/modules/auth/controllers/`                                          | Nest/Fastify、response envelope、API contract 和项目约束     |
