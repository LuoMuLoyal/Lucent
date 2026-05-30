import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import { ConfigKey } from '../config/config-keys.enum';
import { PrismaService } from '../prisma/prisma.service';
import { User, UserStatus } from '../generated/prisma/client';
import { UserService } from '../user/user.service';
import { VerificationCodeService } from './verification-code.service';
import { ResultCode } from '../common/api-envelope';
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
  email: string;
}

interface JwtConfigShape {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: number; // seconds
  refreshTtl: number; // seconds
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly i18n: I18nService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  // ── Registration ─────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ user: User } & TokenPair> {
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

    const tokens = await this.generateTokenPair(user);
    return { user, ...tokens };
  }

  // ── Login ────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<{ user: User } & TokenPair> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.userService.findByEmail(email);

    // Always check rate limit first
    this.checkLoginRateLimit(email);

    if (!user) {
      this.recordLoginFailure(email);
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
      this.recordLoginFailure(email);
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.i18n.t('auth.email_or_password_wrong'),
      });
    }

    // Password-based login
    if (hasPassword) {
      const valid = await argon2.verify(user.passwordHash, password);
      if (!valid) {
        this.recordLoginFailure(email);
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

    this.clearLoginFailures(email);

    const now = new Date();
    const updatedUser = await this.userService.update(user.id, {
      lastLoginAt: now,
      status: UserStatus.active,
    });

    const tokens = await this.generateTokenPair(updatedUser);
    return { user: updatedUser, ...tokens };
  }

  // ── Token Refresh ────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<TokenPair> {
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

    return this.generateTokenPair(record.user);
  }

  // ── Logout ───────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    // Refresh tokens are stored as SHA-256 hashes so DB reads cannot replay them.
    await this.prisma.userSession.deleteMany({
      where: { refreshTokenHash: this.hashRefreshToken(refreshToken) },
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
    return this.userService.update(userId, {
      ...(dto.nickname !== undefined && { nickname: dto.nickname }),
      ...(dto.avatar !== undefined && { avatar: dto.avatar }),
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.getMe(userId);
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

  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<void> {
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

    await this.userService.update(userId, {
      email: newEmail,
      emailVerifiedAt: new Date(),
    });
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.getMe(userId);
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
  ): Promise<{ message: string }> {
    await this.verificationCodeService.send(
      this.normalizeEmail(dto.email),
      dto.scene,
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

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    // 安全策略：无论邮箱是否存在，都返回成功提示（防止邮箱枚举攻击）
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

  // ── Private Helpers ──────────────────────────────────────────

  private async generateTokenPair(user: User): Promise<TokenPair> {
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

  // ── Login Rate Limiting (in-memory, TODO: Redis) ─────────────

  private loginFailures = new Map<
    string,
    { count: number; firstAt: number; lockedUntil?: number }
  >();

  private checkLoginRateLimit(email: string): void {
    const entry = this.loginFailures.get(email);
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

    // Clear if window expired
    if (Date.now() - entry.firstAt > LOGIN_RATE_LIMIT_WINDOW) {
      this.loginFailures.delete(email);
    }
  }

  private recordLoginFailure(email: string): void {
    const entry = this.loginFailures.get(email);
    if (!entry || Date.now() - entry.firstAt > LOGIN_RATE_LIMIT_WINDOW) {
      this.loginFailures.set(email, { count: 1, firstAt: Date.now() });
      return;
    }

    entry.count += 1;
    if (entry.count >= LOGIN_RATE_LIMIT_MAX) {
      entry.lockedUntil = Date.now() + LOGIN_RATE_LIMIT_LOCKOUT;
    }
  }

  private clearLoginFailures(email: string): void {
    this.loginFailures.delete(email);
  }
}
