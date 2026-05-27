import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

import { ConfigKey } from '../config/config-keys.enum';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '../generated/prisma/client';
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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly verificationCodeService: VerificationCodeService,
  ) {}

  private get jwtConfig(): JwtConfigShape {
    return this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  // ── Registration ─────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ user: User } & TokenPair> {
    const exists = await this.userService.findByEmail(dto.email);
    if (exists) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: '该邮箱已被注册',
      });
    }

    const password = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.userService.create({
      email: dto.email,
      password,
      nickname: dto.nickname ?? null,
      emailVerified: false,
    });

    const tokens = await this.generateTokenPair(user);
    return { user, ...tokens };
  }

  // ── Login ────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<{ user: User } & TokenPair> {
    const user = await this.userService.findByEmail(dto.email);

    // Always check rate limit first
    this.checkLoginRateLimit(dto.email);

    if (!user) {
      this.recordLoginFailure(dto.email);
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: '邮箱或密码错误',
      });
    }

    // Password-based login
    if (dto.password) {
      const valid = await argon2.verify(user.password, dto.password);
      if (!valid) {
        this.recordLoginFailure(dto.email);
        throw new UnauthorizedException({
          code: ResultCode.UNAUTHORIZED,
          message: '邮箱或密码错误',
        });
      }
    }

    // Code-based login
    if (dto.code) {
      await this.verificationCodeService.verify(dto.email, dto.code, 'login');
    }
    // TODO: 2FA 校验

    this.clearLoginFailures(dto.email);

    const tokens = await this.generateTokenPair(user);
    return { user, ...tokens };
  }

  // ── Token Refresh ────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: ResultCode.REFRESH_TOKEN_INVALID,
        message: 'refreshToken 无效或已过期',
      });
    }

    // Delete the old refresh token (rotation)
    await this.prisma.refreshToken.delete({
      where: { id: record.id },
    });

    // Delete all other refresh tokens for this user (invalidate all sessions)
    await this.prisma.refreshToken.deleteMany({
      where: { userId: record.userId },
    });

    return this.generateTokenPair(record.user);
  }

  // ── Logout ───────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    // Raw token stored in DB (high-entropy random string, acceptable for most applications).
    // Security relies on HTTPS transport + short expiry.
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  // ── Profile Management ───────────────────────────────────────

  async getMe(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: '用户不存在',
      });
    }
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<User> {
    return this.userService.update(userId, {
      nickname: dto.nickname,
      avatar: dto.avatar,
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.getMe(userId);
    const valid = await argon2.verify(user.password, dto.oldPassword);
    if (!valid) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: '当前密码错误',
      });
    }
    const password = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    await this.userService.update(userId, { password });
    // Invalidate all sessions
    await this.logoutAll(userId);
  }

  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<void> {
    // TODO: 验证码校验
    const exists = await this.userService.findByEmail(dto.newEmail);
    if (exists) {
      throw new ConflictException({
        code: ResultCode.CONFLICT,
        message: '该邮箱已被其他账号使用',
      });
    }
    await this.userService.update(userId, {
      email: dto.newEmail,
      emailVerified: true,
    });
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.getMe(userId);
    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) {
      throw new UnauthorizedException({
        code: ResultCode.WRONG_PASSWORD,
        message: '密码错误',
      });
    }
    // Revoke all tokens then hard-delete
    await this.logoutAll(userId);
    await this.prisma.user.delete({ where: { id: userId } });
  }

  // ── Email Verification & Password Reset (stubs) ──────────────

  async sendVerificationCode(
    dto: SendVerificationCodeDto,
  ): Promise<{ message: string }> {
    await this.verificationCodeService.send(dto.email, dto.scene);
    return { message: '验证码已发送，请查收邮件' };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    await this.verificationCodeService.verify(dto.email, dto.code, 'register');
    await this.userService.updateByEmail(dto.email, { emailVerified: true });
  }

  forgotPassword(_dto: ForgotPasswordDto): { message: string } {
    // TODO: 生成重置 token，发送邮件
    this.logger.warn(`forgotPassword(${_dto.email}): TODO`);
    return { message: '如果该邮箱已注册，重置链接已发送（TODO）' };
  }

  resetPassword(_dto: ResetPasswordDto): void {
    // TODO: 验证 token，重置密码
    this.logger.warn(`resetPassword(${_dto.email}): TODO`);
  }

  // ── Private Helpers ──────────────────────────────────────────

  private async generateTokenPair(user: User): Promise<TokenPair> {
    const config = this.jwtConfig;

    const payload: UserPayload = { sub: user.id, email: user.email };

    const accessTokenId = randomBytes(16).toString('hex');
    const refreshTokenId = randomBytes(32).toString('hex');

    const now = Date.now();
    const accessTokenExpiresInMs = config.accessTtl * 1000;
    const refreshTokenExpiresInMs = config.refreshTtl * 1000;

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: config.accessSecret,
      expiresIn: config.accessTtl,
      algorithm: 'HS512',
      subject: user.id,
      jwtid: accessTokenId,
    });

    // Store refresh token in DB (raw value — it's a high-entropy random string)
    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenId,
        expiresAt: new Date(now + refreshTokenExpiresInMs),
        user: { connect: { id: user.id } },
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenId,
      accessTokenExpiresAt: new Date(
        now + accessTokenExpiresInMs,
      ).toISOString(),
      refreshTokenExpiresAt: new Date(
        now + refreshTokenExpiresInMs,
      ).toISOString(),
    };
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
        message: `登录失败次数过多，请 ${minutes} 分钟后重试`,
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
