export type { OAuthProfile } from './types/oauth.types.js';
export type { UserPayload } from './services/token.service.js';
export { ARGON2_OPTIONS } from './config/argon2-options.js';
export { AppleOAuthProvider } from './providers/apple-oauth.provider.js';
export {
  AuthBetterAuthAdapter,
  BETTER_AUTH_TRUSTED_PROVIDERS,
  CREDENTIAL_PROVIDER_ID,
  isBetterAuthTrustedProvider,
  LOCAL_CREDENTIAL_ISSUER,
} from './adapters/better-auth.adapter.js';
export { AuthService } from './services/auth.service.js';
export { ChangeEmailDto } from './dto/password/change-email.dto.js';
export { ChangePasswordDto } from './dto/password/change-password.dto.js';
export { CurrentUser } from './decorators/current-user.decorator.js';
export { DeleteAccountDto } from './dto/shared/delete-account.dto.js';
export { JwtAuthGuard } from './guards/jwt-auth.guard.js';
export {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/shared/oauth.dto.js';
export { OAuthAuthorizeResponseDto } from './dto/shared/auth-responses.dto.js';
export { Public } from './decorators/public.decorator.js';
export { QqOAuthProvider } from './providers/qq-oauth.provider.js';
export { SetPasswordDto } from './dto/password/set-password.dto.js';
export { WechatMobileOAuthProvider } from './providers/wechat/wechat-mobile-oauth.provider.js';
export { WechatWebOAuthProvider } from './providers/wechat/wechat-web-oauth.provider.js';
export { loginFailureCacheKey } from './services/identity/rate-limit.service.js';
export { PasswordReauthService } from './services/identity/password-reauth.service.js';
