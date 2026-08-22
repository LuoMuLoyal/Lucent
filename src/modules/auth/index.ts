export type { OAuthProfile } from './types/oauth.types';
export type { UserPayload } from './services/token.service';
export { ARGON2_OPTIONS } from './config/argon2-options';
export { AppleOAuthProvider } from './providers/apple-oauth.provider';
export { AuthService } from './services/auth.service';
export { ChangeEmailDto } from './dto/password/change-email.dto';
export { ChangePasswordDto } from './dto/password/change-password.dto';
export { CurrentUser } from './decorators/current-user.decorator';
export { DeleteAccountDto } from './dto/shared/delete-account.dto';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/shared/oauth.dto';
export { OAuthAuthorizeResponseDto } from './dto/shared/auth-responses.dto';
export { Public } from './decorators/public.decorator';
export { QqOAuthProvider } from './providers/qq-oauth.provider';
export { SetPasswordDto } from './dto/password/set-password.dto';
export { WechatMobileOAuthProvider } from './providers/wechat/wechat-mobile-oauth.provider';
export { WechatWebOAuthProvider } from './providers/wechat/wechat-web-oauth.provider';
export { loginFailureCacheKey } from './services/identity/rate-limit.service';
