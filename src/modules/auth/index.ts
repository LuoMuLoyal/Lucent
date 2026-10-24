export type { OAuthProfile } from './types/oauth.types.js';
export type { UserPayload } from './types/auth-request.js';
export { ARGON2_OPTIONS } from './config/argon2-options.js';
export { AppleOAuthProvider } from './infrastructure/oauth/apple.js';
export { AuthIdentityService } from './application/services/identity.js';
export {
  CREDENTIAL_PROVIDER_ID,
  isTrustedIdentityProvider,
  LOCAL_CREDENTIAL_ISSUER,
  TRUSTED_IDENTITY_PROVIDERS,
} from './domain/account/identity-providers.js';
export { AuthService } from './services/auth.service.js';
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
export { QqOAuthProvider } from './infrastructure/oauth/qq.js';
export type { SetPasswordDto } from './dto/password/set-password.dto.js';
export { setPasswordSchema } from './dto/password/set-password.dto.js';
export { WechatMobileOAuthProvider } from './infrastructure/oauth/wechat/wechat-mobile.js';
export { WechatWebOAuthProvider } from './infrastructure/oauth/wechat/wechat-web.js';
export {
  CAPTCHA_THRESHOLD,
  loginFailureCacheKey,
} from './services/identity/rate-limit.service.js';
export type { CaptchaDto } from './dto/shared/captcha.dto.js';
export { captchaSchema } from './dto/shared/captcha.dto.js';
export { PasswordReauthService } from './services/identity/password-reauth.service.js';
export { HumanVerification } from './application/ports/human-verification.js';
export { AuthSessionAdminService } from './services/session-admin.service.js';
