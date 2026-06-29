import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import * as qrcode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConfigKey } from '../../../config/config-keys.enum';

const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_LENGTH = 8; // bytes → hex = 16 chars
const TEMP_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface TwoFactorSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

@Injectable()
export class AuthTwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ── Setup ────────────────────────────────────────────────────────

  async generateSetup(userId: string): Promise<TwoFactorSetupResult> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const secret = generateSecret();
    const appName =
      this.configService.get<string>(`${ConfigKey.App}.name`) ?? 'Lumos';
    const label = user.email ?? userId;
    const otpauthUrl = generateURI({
      issuer: appName,
      label: label,
      secret,
    });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    // Store secret temporarily — only confirmed after verifySetup
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async confirmSetup(userId: string, code: string): Promise<string[]> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorSecret: true },
    });

    if (!user.twoFactorSecret) {
      throw new Error('TWO_FACTOR_NOT_INITIALIZED');
    }

    const vResult = await verify({ token: code, secret: user.twoFactorSecret });
    if (!vResult.valid) {
      throw new Error('INVALID_TWO_FACTOR_CODE');
    }

    const recoveryCodes = this.generateRecoveryCodes();
    const recoveryCodesHash = this.hashRecoveryCodes(recoveryCodes);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorRecoveryCodes: recoveryCodesHash,
      },
    });

    return recoveryCodes;
  }

  // ── Verification ─────────────────────────────────────────────────

  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorSecret: true },
    });

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return false;
    }

    const result = await verify({ token: code, secret: user.twoFactorSecret });
    return result.valid;
  }

  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorRecoveryCodes: true },
    });

    if (!user.twoFactorRecoveryCodes) return false;

    const storedHashes = user.twoFactorRecoveryCodes.split(',');
    const codeHash = this.hashCode(code);

    const matchIndex = storedHashes.findIndex((h) => h === codeHash);
    if (matchIndex === -1) return false;

    // Remove used code
    storedHashes.splice(matchIndex, 1);
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorRecoveryCodes: storedHashes.join(',') },
    });

    return true;
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: null,
      },
    });
  }

  // ── Temp token for login flow ─────────────────────────────────────

  createTempToken(userId: string): string {
    const payload = `${userId}:${Date.now().toString()}:${randomBytes(16).toString('hex')}`;
    return Buffer.from(payload).toString('base64url');
  }

  verifyTempToken(token: string, userId: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');
      const timestampStr = parts[1];
      const tokenUserId = parts[0];
      if (!tokenUserId || !timestampStr) return false;
      if (tokenUserId !== userId) return false;
      const timestamp = parseInt(timestampStr, 10);
      return Date.now() - timestamp < TEMP_TOKEN_TTL_MS;
    } catch {
      return false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(RECOVERY_CODE_LENGTH).toString('hex'),
    );
  }

  private hashRecoveryCodes(codes: string[]): string {
    return codes.map((c) => this.hashCode(c)).join(',');
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
