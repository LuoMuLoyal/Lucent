/**
 * 人机验证（CAPTCHA）的出站端口。
 *
 * ## 为什么是端口
 *
 * 验证「来源是不是浏览器」要调用 Cloudflare，而调用失败时的**失败策略**是
 * 安全决策（不变量 #5）。端口把这两件事分开：实现负责「怎么问 Cloudflare」，
 * 策略由实现内部按下面的契约固定下来，应用层只看到 `verify`。
 *
 * ## 失败策略（不变量 #5，**不得改动**）
 *
 * 三个分支，优先级从高到低：
 *
 * 1. **未配置即关闭**：没有凭据时每个 token 都通过。本地开发与 e2e 因此不需要
 *    Cloudflare 账号；生产未配置不会把用户锁在门外（但也没有防护）。
 * 2. **拿不到答案就放行**（fail open）：Cloudflare 不可达、超时、返回非 2xx 或
 *    响应体解不开时**允许请求并 `warn`**。验证服务故障不能升级成登录故障——
 *    否则 Cloudflare 一抖就把所有人锁在门外。
 * 3. **拿到否定答案就拒绝**（fail closed）：格式正确的 `success: false` 是**真实
 *    裁决**，返回 `AUTH_CAPTCHA_INVALID`。
 *
 * 第 2 条是最容易被「顺手改成 fail-close」的一条。改它等于把第三方可用性
 * 变成自家登录可用性的上限。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

export abstract class HumanVerification {
  /** 该部署是否启用人机验证（供 `GET /auth/captcha` 告诉客户端要不要渲染）。 */
  abstract get enabled(): boolean;

  /** 公开 site key，交给客户端渲染组件。 */
  abstract get siteKey(): string;

  /**
   * 校验一个客户端提交的 token。
   *
   * @param token 客户端拿到的挑战响应；`undefined` / 空串在启用时即拒绝。
   * @param remoteIp 客户端 IP，转发给 Cloudflare 作为额外信号。
   *
   * 失败语义见文件头：只有**明确的否定裁决**才是 `AUTH_CAPTCHA_INVALID`；
   * 缺少 token 是 `AUTH_CAPTCHA_REQUIRED`；依赖故障放行。
   */
  abstract verify(
    token: string | undefined,
    remoteIp?: string,
  ): ResultAsync<void, DomainFailure>;
}
