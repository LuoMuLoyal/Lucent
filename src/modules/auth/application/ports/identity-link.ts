/**
 * 身份链接能力端口 —— `account` 需要 auth 做的 OAuth 身份绑定操作。
 *
 * ## 为什么是「链接」而不是「登录」
 *
 * `AuthOAuthFacadeService` 有十几组方法，分两类：
 *
 * | 类别 | 方法 | 收进端口？ |
 * | --- | --- | --- |
 * | **已认证的绑定** | `createWechatWebIdentityLinkAuthorizeUrl`、`linkWechatWebIdentity`、`linkWechatMobileIdentity` | ✅ |
 * | 登录 | `loginWithWechatWeb` / `Mobile` / `Apple` / `Qq` / `Google` | ❌ |
 * | 登录授权 URL | `createWechatWebAuthorizeUrl`、`createQqAuthorizeUrl`、`createGoogleAuthorizeUrl` | ❌ |
 * | 回调跳转 | `resolveWechatWebCallbackRedirect` | ❌ |
 *
 * **判据同样是「已认证 vs 未认证」**：登录流程发生在「我还没有会话」时，
 * 它的调用者必须是公开端点；而 `account` 的每个端点都要求 access token。
 * 把登录方法放进这个端口，等于给一个已认证的上下文开了「以别人身份登录」的口子
 * ——即便实现没这么用，**端口形状本身就是错误的能力声明**。
 *
 * ## 为什么只有微信
 *
 * 可**显式绑定**的只有微信（web 与 mobile 两条）。Apple / Google 是
 * **受信提供商**，它们走登录时的自动关联（按已验证邮箱），**不允许显式绑定**
 * ——`domain/account/oauth-identity.ts` 的 `canExplicitlyLink` 会拒绝。
 * 所以这里没有 apple/google 的方法：不是遗漏，是那条路被领域规则关掉了。
 * 如果把 `linkGoogleIdentity` 加进这个端口，它唯一可能的实现就是「返回冲突」。
 *
 * ## 跨上下文的同步调用
 *
 * 与 `credentials-self-service.ts` 同理：User Profile 与 Identity & Access
 * 是 partnership，同进程同步调用，不是分布式单体。
 */
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { OAuthAuthorizeResult } from '../../types/oauth.types.js';
import type { OAuthCallbackDto } from '../../dto/shared/oauth.dto.js';
import type { OAuthCodeCallbackDto } from '../../dto/shared/oauth.dto.js';

export abstract class IdentityLink {
  /**
   * 生成「绑定微信网页身份」的授权 URL。
   *
   * 与登录用的 `createWechatWebAuthorizeUrl` 的区别只在 **purpose**
   * （`link` vs `login`）——它写进 OAuth state，回调时据此校验。
   */
  abstract createWechatWebIdentityLinkAuthorizeUrl(dto?: {
    callbackUri?: string | undefined;
  }): ResultAsync<OAuthAuthorizeResult, DomainFailure>;

  /**
   * 完成微信网页身份绑定（回调）。
   *
   * 受信提供商会返回 `RESOURCE_CONFLICT`——见端口文件头。
   */
  abstract linkWechatWebIdentity(
    userId: string,
    dto: OAuthCallbackDto,
  ): ResultAsync<void, DomainFailure>;

  /** 完成微信移动端身份绑定（原生 SDK 拿到的 code）。 */
  abstract linkWechatMobileIdentity(
    userId: string,
    dto: OAuthCodeCallbackDto,
  ): ResultAsync<void, DomainFailure>;
}
