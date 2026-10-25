import 'reflect-metadata';

import { OAUTH_PROVIDER_TOKENS } from '../ports/oauth-provider.js';
import { AuthOAuthFacadeService } from './oauth-facade.js';

/**
 * **DI token 装配的静态护栏。**
 *
 * ## 它防的是什么
 *
 * 2026-10-25 发现：把 `AuthOAuthFacadeService` 的 5 个提供商依赖从**具体类**
 * 改成**端口 interface**（`OAuthProvider`）后，**整个应用启动失败**——
 * interface 在运行时不存在，Nest 把 5 个构造参数全部解析成 `Object`：
 *
 * ```
 * Nest can't resolve dependencies of the AuthOAuthFacadeService
 * (UserService, ?, Object, Object, Object, Object, ...)
 * ```
 *
 * 当时三种检查**全部通过**：
 * - `pnpm typecheck` —— 类型层面 `interface` 完全合法；
 * - 单元测试 —— 手工 `new` 或只列自己需要的 provider，不走完整 DI；
 * - `pnpm lint:check`。
 *
 * 唯一发现途径是 `pnpm export:openapi`（它会 `NestFactory.create(AppModule)`），
 * 而它的失败被 Nest 的 `ExceptionsZone` 吞掉了输出，表现成「exit 1 且零输出」。
 *
 * ## 为什么不在这里实例化整个 AuthModule
 *
 * `AuthModule` 会牵进 `PrismaService`（需要 `ConfigService` 与真实 env）、
 * Redis 与 BullMQ，需要完整基础设施。**e2e 覆盖那一层**（`createTestApp()`
 * 会 compile `AppModule`）。
 *
 * 本文件只断言**这一处**踩过的坑：**提供商参数必须带显式 `@Inject` token，
 * 不能靠类型注入**。它不需要任何基础设施，所以能进单测门禁。
 */
describe('AuthOAuthFacadeService — 提供商 DI token', () => {
  /** Nest 把 `@Inject(token)` 记在 `design:paramtypes` 旁边的自定义元数据里。 */
  const PARAM_TYPES = 'design:paramtypes';
  const SELF_DECLARED_DEPS = 'self:paramtypes';

  function injectedTokens(): Map<number, unknown> {
    const tokens = new Map<number, unknown>();
    // Nest 为 `@Inject(x)` 写入 `self:paramtypes`：`[{ index, param }]`。
    const declared: { index: number; param: unknown }[] =
      (Reflect.getMetadata(SELF_DECLARED_DEPS, AuthOAuthFacadeService) as
        | { index: number; param: unknown }[]
        | undefined) ?? [];
    for (const entry of declared) tokens.set(entry.index, entry.param);
    return tokens;
  }

  it('5 个提供商参数全部带显式 token（而不是类型注入）', () => {
    const tokens = injectedTokens();

    // 构造参数顺序：0 UserService, 1..5 提供商, 6..9 其他。
    const providerIndexes = [1, 2, 3, 4, 5];
    for (const index of providerIndexes) {
      expect(tokens.get(index)).toBeDefined();
      expect(typeof tokens.get(index)).toBe('string');
    }
  });

  it('每个提供商 token 互不相同（同类型实例靠 token 区分）', () => {
    const tokens = injectedTokens();
    const providerTokens = [1, 2, 3, 4, 5].map((i) => tokens.get(i));

    expect(new Set(providerTokens).size).toBe(5);
  });

  it('token 与 `OAUTH_PROVIDER_TOKENS` 常量一致', () => {
    const tokens = injectedTokens();
    const providerTokens = [1, 2, 3, 4, 5].map((i) => tokens.get(i));

    expect(providerTokens).toEqual([
      OAUTH_PROVIDER_TOKENS.wechatWeb,
      OAUTH_PROVIDER_TOKENS.wechatMobile,
      OAUTH_PROVIDER_TOKENS.qq,
      OAUTH_PROVIDER_TOKENS.google,
      OAUTH_PROVIDER_TOKENS.apple,
    ]);
  });

  it('**反例锚点**：类型注入会得到 `Object`，这正是启动失败的原因', () => {
    // `design:paramtypes` 在 interface 上记录的是 `Object`——它不能当 token。
    // 这条断言把「为什么必须用 @Inject」钉在测试里，而不是只写在注释里。
    const paramTypes: unknown[] =
      (Reflect.getMetadata(PARAM_TYPES, AuthOAuthFacadeService) as
        | unknown[]
        | undefined) ?? [];

    // 提供商那 5 个位置在类型元数据里就是 `Object`（interface 的运行时表示）。
    for (const index of [1, 2, 3, 4, 5]) {
      expect(paramTypes[index]).toBe(Object);
    }
  });
});
