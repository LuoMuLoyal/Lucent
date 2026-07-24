export type { OAuthProfile } from './types/oauth.types';
export type { UserPayload } from './services/token.service';
export { ARGON2_OPTIONS } from './config/argon2-options';
export { AppleOAuthProvider } from './providers/apple-oauth.provider';
export { AuthService } from './services/auth.service';
export { ChangeEmailDto } from './dto/change-email.dto';
export { ChangePasswordDto } from './dto/change-password.dto';
export { CurrentUser } from './decorators/current-user.decorator';
export { DeleteAccountDto } from './dto/delete-account.dto';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/oauth.dto';
export {
  OAuthAuthorizeResponseDto,
  SuccessResponseDto,
} from './dto/auth-responses.dto';
export { Public } from './decorators/public.decorator';
export { QqOAuthProvider } from './providers/qq-oauth.provider';
export { SetPasswordDto } from './dto/set-password.dto';
export { WechatMobileOAuthProvider } from './providers/wechat-mobile-oauth.provider';
export { WechatWebOAuthProvider } from './providers/wechat-web-oauth.provider';
export { loginFailureCacheKey } from './services/identity/rate-limit.service';
