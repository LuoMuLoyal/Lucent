import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import { ConfigKey } from '../../config/config-keys.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { User, UserStatus } from '../../generated/prisma/client';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './verification-code.service';
import { ResultCode } from '../../common/api-envelope';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
} from './dto/oauth.dto';
import { WechatWebOAuthProvider } from './wechat-web-oauth.provider';
import { WechatMobileOAuthProvider } from './wechat-mobile-oauth.provider';
import {
  OAUTH_PROVIDER_WECHAT_WEB,
  type OAuthProvider,
  type OAuthAuthorizeResult,
  type OAuthProfile,
} from './oauth.types';

// Login rate limiting
const LOGIN_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const LOGIN_RATE_LIMIT_MAX = 10;
const LOGIN_RATE_LIMIT_LOCKOUT = 60 * 60 * 1000; // 1 hour

// Argon2id options (recommended by OWASP 2024)
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface UserPayload {
  sub: string;
  email: string | null;
}

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

interface JwtConfigShape {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number; // seconds
  refreshTtl: number; // seconds
}

interface LoginFailureBucket {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

interface OAuthStateEntry {
  provider: typeof OAUTH_PROVIDER_WECHAT_WEB;
  callbackUri?: string;
}

const OAUTH_STATE_TTL = 10 * 60 * 1000;
const OAUTH_STATE_TTL_SEC = OAUTH_STATE_TTL / 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly wechatWebOAuthProvider: WechatWebOAuthProvider,
    private readonly wechatMobileOAuthProvider: WechatMobileOAuthProvider,
    private readonly i18n: I18nService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  // ── Registration ─────────────────────────────────────────────

  async register(
    dto: RegisterDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const email = this.normalizeEmail(dto.email);
    const exists = await this.userService.findByEmail(email);
    if (exists) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: this.i18n.t('auth.email_already_registered'),
      });
    }

    await this.verificationCodeService.verify(email, dto.code, 'register');

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const now = new Date();

    const user = await this.userService.create({
      email,
      passwordHash,
      nickname: dto.nickname ?? null,
      emailVerifiedAt: now,
      profile: { create: {} },
    });

    const tokens = await this.generateTokenPair(user, context);
    return { user, ...tokens };
  }

  // ── Login ────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const email = this.normalizeEmail(dto.email);
    await this.checkLoginRateLimit(email);

    const user = await this.userService.findByEmail(email);

    if (!user) {
      await this.recordLoginFailure(email);
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.email_or_password_wrong'),
      });
    }

    const password = dto.password;
    const code = dto.code;
    const hasPassword = password !== undefined;
    const hasCode = code !== undefined;
    if (hasPassword === hasCode) {
      await this.recordLoginFailure(email);
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.email_or_password_wrong'),
      });
    }

    // Password-based login
    if (hasPassword) {
      if (!user.passwordHash) {
        await this.recordLoginFailure(email);
        throw new UnauthorizedException({
          code: ResultCode.UNAUTHORIZED,
          message: this.i18n.t('auth.email_or_password_wrong'),
        });
      }

      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        await this.recordLoginFailure(email);
        throw new UnauthorizedException({
          code: ResultCode.UNAUTHORIZED,
          message: this.i18n.t('auth.email_or_password_wrong'),
        });
      }
    }

    // Code-based login
    if (hasCode) {
      await this.verificationCodeService.verify(email, code, 'login');
    }
    // TODO: 2FA 校验

    await this.clearLoginFailures(email);

    const now = new Date();
    const updatedUser = await this.userService.update(user.id, {
      lastLoginAt: now,
      status: UserStatus.active,
    });

    const tokens = await this.generateTokenPair(updatedUser, context);
    return { user: updatedUser, ...tokens };
  }

  // ── Token Refresh ────────────────────────────────────────────

  async refresh(
    refreshToken: string,
    context?: AuthRequestContext,
  ): Promise<TokenPair> {
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const record = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date() || record.revokedAt !== null) {
      throw new UnauthorizedException({
        code: ResultCode.REFRESH_TOKEN_INVALID,
        message: this.i18n.t('auth.refresh_token_invalid'),
      });
    }

    // Delete the old refresh token (rotation)
    await this.prisma.userSession.delete({
      where: { id: record.id },
    });

    return this.generateTokenPair(record.user, context);
  }

  // ── Logout ───────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string): Promise<void> {
    // Refresh tokens are stored as SHA-256 hashes so DB reads cannot replay them.
    await this.prisma.userSession.deleteMany({
      where: {
        userId,
        refreshTokenHash: this.hashRefreshToken(refreshToken),
      },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.userSession.deleteMany({
      where: { userId },
    });
  }

  // ── Profile Management ───────────────────────────────────────

  async getMe(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<User> {
    const nickname = dto.nickname === '' ? null : dto.nickname;
    const avatar = dto.avatar === '' ? null : dto.avatar;

    return this.userService.update(userId, {
      ...(dto.nickname !== undefined && { nickname }),
      ...(dto.avatar !== undefined && { avatar }),
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.getMe(userId);
    if (!user.passwordHash) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: this.i18n.t('auth.current_password_wrong'),
      });
    }

    const valid = await argon2.verify(user.passwordHash, dto.oldPassword);
    if (!valid) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: this.i18n.t('auth.current_password_wrong'),
      });
    }
    const passwordHash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    await this.userService.update(userId, { passwordHash });
    // Invalidate all sessions
    await this.logoutAll(userId);
  }

  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<User> {
    await this.getMe(userId);
    const newEmail = this.normalizeEmail(dto.newEmail);

    const exists = await this.userService.findByEmail(newEmail);
    if (exists) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: this.i18n.t('auth.email_in_use'),
      });
    }

    // 校验发往新邮箱的验证码，确认新邮箱归属。
    await this.verificationCodeService.verify(
      newEmail,
      dto.code,
      'change-email',
    );

    return this.userService.update(userId, {
      email: newEmail,
      emailVerifiedAt: new Date(),
    });
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.getMe(userId);
    if (!user.passwordHash) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: this.i18n.t('auth.password_wrong'),
      });
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: this.i18n.t('auth.password_wrong'),
      });
    }
    // Revoke all tokens then soft-delete
    await this.logoutAll(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: UserStatus.deleted },
    });
  }

  // ── Email Verification & Password Reset ──────────────────────

  async sendVerificationCode(
    dto: SendVerificationCodeDto,
    clientKey?: string,
  ): Promise<{ message: string }> {
    await this.verificationCodeService.send(
      this.normalizeEmail(dto.email),
      dto.scene,
      clientKey,
    );
    return { message: this.i18n.t('auth.verification_code_sent') };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    await this.verificationCodeService.verify(email, dto.code, 'register');
    await this.userService.updateByEmail(email, {
      emailVerifiedAt: new Date(),
    });
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    clientKey?: string,
  ): Promise<{ message: string }> {
    // 安全策略：无论邮箱是否存在，都返回成功提示（防止邮箱枚举攻击）
    await this.verificationCodeService.assertClientRateLimit(clientKey);
    const email = this.normalizeEmail(dto.email);
    const user = await this.userService.findByEmail(email);
    if (user) {
      await this.verificationCodeService.send(email, 'reset-password');
    }
    return { message: this.i18n.t('auth.forgot_password_hint') };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const email = this.normalizeEmail(dto.email);
    await this.verificationCodeService.verify(
      email,
      dto.code,
      'reset-password',
    );
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    // 重置密码后登出所有设备
    await this.logoutAll(user.id);
  }

  // ── OAuth ────────────────────────────────────────────────────

  async createWechatWebAuthorizeUrl(
    dto?: OAuthAuthorizeDto,
  ): Promise<OAuthAuthorizeResult> {
    const state = randomBytes(24).toString('base64url');
    const callbackUri = this.normalizeLoopbackCallbackUri(dto?.callbackUri);
    await this.cache.set(
      this.oauthStateKey(OAUTH_PROVIDER_WECHAT_WEB, state),
      {
        provider: OAUTH_PROVIDER_WECHAT_WEB,
        ...(callbackUri !== undefined && { callbackUri }),
      },
      OAUTH_STATE_TTL,
    );

    return {
      authorizeUrl: this.wechatWebOAuthProvider.buildAuthorizeUrl(state),
      state,
      expiresIn: OAUTH_STATE_TTL_SEC,
      ...(callbackUri !== undefined && { callbackUri }),
    };
  }

  async resolveWechatWebCallbackRedirect(
    dto: OAuthCallbackDto,
  ): Promise<string> {
    const entry = await this.peekOAuthState(
      OAUTH_PROVIDER_WECHAT_WEB,
      dto.state,
    );
    if (entry.callbackUri === undefined) {
      throw new BadRequestException({
        code: ResultCode.BAD_REQUEST,
        message: this.i18n.t('auth.oauth_callback_uri_missing'),
      });
    }

    const redirectUrl = new URL(entry.callbackUri);
    redirectUrl.searchParams.set('code', dto.code);
    redirectUrl.searchParams.set('state', dto.state);
    return redirectUrl.toString();
  }

  async loginWithWechatWeb(
    dto: OAuthCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    await this.consumeOAuthState(OAUTH_PROVIDER_WECHAT_WEB, dto.state);
    const profile = await this.wechatWebOAuthProvider.fetchProfile(dto.code);
    return this.loginWithOAuthProfile(profile, context);
  }

  async loginWithWechatMobile(
    dto: OAuthCodeCallbackDto,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const profile = await this.wechatMobileOAuthProvider.fetchProfile(dto.code);
    return this.loginWithOAuthProfile(profile, context);
  }

  // ── Private Helpers ──────────────────────────────────────────

  private async generateTokenPair(
    user: User,
    context?: AuthRequestContext,
  ): Promise<TokenPair> {
    const config = this.jwtConfig;

    const payload: UserPayload = { sub: user.id, email: user.email };

    const accessTokenId = randomBytes(16).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    const now = Date.now();
    const accessTokenExpiresInMs = config.accessTtl * 1000;
    const refreshTokenExpiresInMs = config.refreshTtl * 1000;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: config.accessSecret,
      expiresIn: config.accessTtl,
      algorithm: 'HS512',
      jwtid: accessTokenId,
    });

    // Persist only the hash of the refresh token; the plaintext token is returned once.
    await this.prisma.userSession.create({
      data: {
        refreshTokenHash,
        expiresAt: new Date(now + refreshTokenExpiresInMs),
        lastUsedAt: new Date(now),
        ...this.getSessionContextData(context),
        user: { connect: { id: user.id } },
      },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(
        now + accessTokenExpiresInMs,
      ).toISOString(),
      refreshTokenExpiresAt: new Date(
        now + refreshTokenExpiresInMs,
      ).toISOString(),
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async loginWithOAuthProfile(
    profile: OAuthProfile,
    context?: AuthRequestContext,
  ): Promise<{ user: User } & TokenPair> {
    const user = await this.findOrCreateOAuthUser(profile);

    const now = new Date();
    const updatedUser = await this.userService.update(user.id, {
      lastLoginAt: now,
      status: UserStatus.active,
      ...(profile.nickname !== undefined && { nickname: profile.nickname }),
      ...(profile.avatar !== undefined && { avatar: profile.avatar }),
    });

    const tokens = await this.generateTokenPair(updatedUser, context);
    return { user: updatedUser, ...tokens };
  }

  private async findOrCreateOAuthUser(profile: OAuthProfile): Promise<User> {
    const linkedUser = await this.userService.findByIdentity(
      profile.provider,
      profile.providerUserId,
    );
    if (linkedUser) {
      return linkedUser;
    }

    if (profile.unionId) {
      const existingUnionUser = await this.userService.findByProviderUnionId(
        profile.unionId,
      );
      if (existingUnionUser) {
        await this.linkOAuthIdentity(existingUnionUser.id, profile);
        return existingUnionUser;
      }
    }

    if (profile.email) {
      const existingUser = await this.userService.findByEmail(
        this.normalizeEmail(profile.email),
      );
      if (existingUser) {
        await this.linkOAuthIdentity(existingUser.id, profile);
        return existingUser;
      }
    }

    return this.userService.createOAuthUser({
      ...(profile.email !== undefined && {
        email:
          profile.email === null ? null : this.normalizeEmail(profile.email),
      }),
      ...(profile.nickname !== undefined && { nickname: profile.nickname }),
      ...(profile.avatar !== undefined && { avatar: profile.avatar }),
      ...(profile.emailVerifiedAt !== undefined && {
        emailVerifiedAt: profile.emailVerifiedAt,
      }),
      identity: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        ...(profile.unionId !== undefined && {
          providerUnionId: profile.unionId,
        }),
        ...(profile.email !== undefined && {
          email:
            profile.email === null ? null : this.normalizeEmail(profile.email),
        }),
        ...(profile.emailVerifiedAt !== undefined && {
          emailVerifiedAt: profile.emailVerifiedAt,
        }),
        ...(profile.rawProfile !== undefined && {
          rawProfile: profile.rawProfile,
        }),
      },
    });
  }

  private async linkOAuthIdentity(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    await this.userService.linkIdentity(userId, {
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      ...(profile.unionId !== undefined && {
        providerUnionId: profile.unionId,
      }),
      ...(profile.email !== undefined && {
        email:
          profile.email === null ? null : this.normalizeEmail(profile.email),
      }),
      ...(profile.emailVerifiedAt !== undefined && {
        emailVerifiedAt: profile.emailVerifiedAt,
      }),
      ...(profile.rawProfile !== undefined && {
        rawProfile: profile.rawProfile,
      }),
    });
  }

  private async consumeOAuthState(
    provider: typeof OAUTH_PROVIDER_WECHAT_WEB,
    state: string,
  ): Promise<OAuthStateEntry> {
    const key = this.oauthStateKey(provider, state);
    const entry = await this.cache.get<OAuthStateEntry>(key);
    await this.cache.del(key);

    if (!this.isValidOAuthStateEntry(entry, provider)) {
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.oauth_state_invalid'),
      });
    }

    return entry;
  }

  private async peekOAuthState(
    provider: typeof OAUTH_PROVIDER_WECHAT_WEB,
    state: string,
  ): Promise<OAuthStateEntry> {
    const entry = await this.cache.get<OAuthStateEntry>(
      this.oauthStateKey(provider, state),
    );

    if (!this.isValidOAuthStateEntry(entry, provider)) {
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.oauth_state_invalid'),
      });
    }

    return entry;
  }

  private oauthStateKey(provider: OAuthProvider, state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `auth:oauth-state:${provider}:${digest}`;
  }

  private isValidOAuthStateEntry(
    entry: unknown,
    provider: typeof OAUTH_PROVIDER_WECHAT_WEB,
  ): entry is OAuthStateEntry {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const candidate = entry as Partial<OAuthStateEntry>;
    return (
      candidate.provider === provider &&
      (candidate.callbackUri === undefined ||
        typeof candidate.callbackUri === 'string')
    );
  }

  private normalizeLoopbackCallbackUri(
    callbackUri: string | undefined,
  ): string | undefined {
    const trimmed = callbackUri?.trim();
    if (!trimmed) {
      return undefined;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw this.invalidOAuthCallbackUri();
    }

    const hostname = parsed.hostname.toLowerCase();
    const isLoopbackHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';

    if (
      parsed.protocol !== 'http:' ||
      !isLoopbackHost ||
      parsed.port.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.hash.length > 0
    ) {
      throw this.invalidOAuthCallbackUri();
    }

    parsed.search = '';
    return parsed.toString();
  }

  private invalidOAuthCallbackUri(): BadRequestException {
    return new BadRequestException({
      code: ResultCode.BAD_REQUEST,
      message: this.i18n.t('auth.oauth_callback_uri_invalid'),
    });
  }

  private getSessionContextData(context: AuthRequestContext | undefined): {
    ipAddress?: string;
    userAgent?: string;
  } {
    return {
      ...(context?.ipAddress !== undefined && { ipAddress: context.ipAddress }),
      ...(context?.userAgent !== undefined && { userAgent: context.userAgent }),
    };
  }

  // ── Login Rate Limiting ─────────────────────────────────────

  private async checkLoginRateLimit(email: string): Promise<void> {
    const key = this.loginFailureKey(email);
    const entry = await this.cache.get<LoginFailureBucket>(key);
    if (!entry) return;

    if (entry.lockedUntil && entry.lockedUntil > Date.now()) {
      const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
      throw new UnauthorizedException({
        code: ResultCode.LOGIN_RATE_LIMITED,
        message: this.i18n.t('auth.login_rate_limited', {
          args: { minutes },
        }),
      });
    }

    if (!this.isValidLoginFailureBucket(entry) || entry.resetAt <= Date.now()) {
      await this.cache.del(key);
    }
  }

  private async recordLoginFailure(email: string): Promise<void> {
    const key = this.loginFailureKey(email);
    const now = Date.now();
    const entry = await this.cache.get<LoginFailureBucket>(key);

    if (
      !this.isValidLoginFailureBucket(entry) ||
      entry.resetAt <= now ||
      entry.lockedUntil !== undefined
    ) {
      await this.cache.set(
        key,
        { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW },
        LOGIN_RATE_LIMIT_WINDOW,
      );
      return;
    }

    const next: LoginFailureBucket = {
      count: entry.count + 1,
      resetAt: entry.resetAt,
      ...(entry.count + 1 >= LOGIN_RATE_LIMIT_MAX && {
        lockedUntil: now + LOGIN_RATE_LIMIT_LOCKOUT,
      }),
    };
    const ttl = Math.max(
      next.resetAt - now,
      (next.lockedUntil ?? next.resetAt) - now,
    );
    await this.cache.set(key, next, ttl);
  }

  private async clearLoginFailures(email: string): Promise<void> {
    await this.cache.del(this.loginFailureKey(email));
  }

  private loginFailureKey(email: string): string {
    const digest = createHash('sha256').update(email).digest('hex');
    return `auth:login-failure:${digest}`;
  }

  private isValidLoginFailureBucket(
    bucket: unknown,
  ): bucket is LoginFailureBucket {
    if (typeof bucket !== 'object' || bucket === null) {
      return false;
    }

    const candidate = bucket as Partial<LoginFailureBucket>;
    return (
      typeof candidate.count === 'number' &&
      typeof candidate.resetAt === 'number' &&
      (candidate.lockedUntil === undefined ||
        typeof candidate.lockedUntil === 'number')
    );
  }
}
