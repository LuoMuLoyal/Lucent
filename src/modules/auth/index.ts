export type { UserPayload } from './types/auth-request.js';
/**
 * 提供商归一化后的身份形状 —— 端口契约。
 *
 * 导出它是因为 e2e 需要构造 provider 替身；**领域层不认识这个类型**，
 * 它只认识 domain/account/oauth-identity.ts 的 OAuthIdentity。
 */
export type { OAuthProviderProfile } from './application/ports/oauth-provider.js';
export { ARGON2_OPTIONS } from './config/argon2-options.js';
/**
 * 提供商具体类 —— **导出只为 e2e 替身**。
 *
 * 生产代码不该经 barrel 取它们（跨模块依赖的是 OAuthProvider 端口）；
 * e2e 需要用 `app.get(WechatWebOAuthProvider)` 拿到实例再打桩，
 * 这是测试 seam，不是公开 API。
 */
export { AppleOAuthProvider } from './infrastructure/oauth/apple.js';
export { QqOAuthProvider } from './infrastructure/oauth/qq.js';
export { WechatMobileOAuthProvider } from './infrastructure/oauth/wechat/wechat-mobile.js';
export { WechatWebOAuthProvider } from './infrastructure/oauth/wechat/wechat-web.js';
export { AuthIdentityService } from './application/services/identity.js';
export {
  CREDENTIAL_PROVIDER_ID,
  isTrustedIdentityProvider,
  LOCAL_CREDENTIAL_ISSUER,
  TRUSTED_IDENTITY_PROVIDERS,
} from './domain/account/identity-providers.js';
export type { ChangeEmailDto } from './dto/password/change-email.dto.js';
export { changeEmailSchema } from './dto/password/change-email.dto.js';
export type { ChangePasswordDto } from './dto/password/change-password.dto.js';
export { changePasswordSchema } from './dto/password/change-password.dto.js';
export { CurrentUser } from './decorators/current-user.decorator.js';
export type { DeleteAccountDto } from './dto/shared/delete-account.dto.js';
export { deleteAccountSchema } from './dto/shared/delete-account.dto.js';
export { JwtAuthGuard } from './guards/jwt-auth.guard.js';
export type {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/shared/oauth.dto.js';
export {
  oauthAuthorizeSchema,
  oauthCallbackSchema,
  oauthCodeCallbackSchema,
} from './dto/shared/oauth.dto.js';
export type { OAuthAuthorizeResponseDto } from './dto/shared/auth-responses.dto.js';
export { oauthAuthorizeResponseSchema } from './dto/shared/auth-responses.dto.js';
export { Public } from './decorators/public.decorator.js';
export type { SetPasswordDto } from './dto/password/set-password.dto.js';
export { setPasswordSchema } from './dto/password/set-password.dto.js';
export {
  CAPTCHA_THRESHOLD,
  loginFailureCacheKey,
} from './application/services/rate-limit.js';
export type { CaptchaDto } from './dto/shared/captcha.dto.js';
export { captchaSchema } from './dto/shared/captcha.dto.js';
export { PasswordReauthService } from './application/services/password-reauth.js';
export { HumanVerification } from './application/ports/human-verification.js';
/**
 * 账号自助能力端口 —— 给 ccount 上下文用的**已认证**操作。
 *
 * 只含 change/set password + change email；未认证路径（发码、找回、重置）
 * 不在其中，理由见端口文件头。
 */
export { CredentialsSelfService } from './application/ports/credentials-self-service.js';
/**
 * 身份链接能力端口 —— 已认证的 OAuth 绑定操作（仅微信：apple/google 走
 * 登录自动关联，不允许显式绑定）。
 */
export { IdentityLink } from './application/ports/identity-link.js';
/** 删号用例 —— 唯一跨聚合编排（先撤会话再删号，顺序不可交换）。 */
export { DeleteAccount } from './application/use_cases/delete-account.js';
export { AuthSessionAdminService } from './application/services/session-admin.js';
