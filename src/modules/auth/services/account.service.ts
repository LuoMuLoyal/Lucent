import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { I18nService } from 'nestjs-i18n';

import { User } from '#generated/prisma/client';
import { badRequest, notFound } from '../../../common';
import { normalizeEmail } from '../../../common';
import { now } from '../../../common';
import { UserService } from '../../user';
import { DeleteAccountDto } from '../dto/shared/delete-account.dto';
import { VerificationCodeService } from './identity/verification-code.service';
import { AuthAccountRepositoryPort } from '../repositories/account.repository';

@Injectable()
export class AuthAccountService {
  private readonly logger = new Logger(AuthAccountService.name);

  constructor(
    private readonly accountRepository: AuthAccountRepositoryPort,
    private readonly userService: UserService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly i18n: I18nService,
  ) {}

  async getActiveUser(userId: string): Promise<User> {
    const user = await this.userService.findById(userId);
    if (!user) {
      notFound(this.i18n.t('auth.user_not_found'));
    }
    return user;
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.getActiveUser(userId);

    if (dto.password) {
      if (!user.passwordHash) {
        throw new UnauthorizedException({
          code: 'AUTH_WRONG_PASSWORD',
          message: this.i18n.t('auth.use_code_for_oauth_account_deletion'),
        });
      }
      let valid: boolean;
      try {
        valid = await argon2.verify(user.passwordHash, dto.password);
      } catch (error) {
        // Corrupted or invalid hash — treat as wrong password, not a 500,
        // but log the underlying error so infrastructure issues (argon2
        // module misconfiguration, OOM, etc.) are not silently masked.
        this.logger.warn(
          `argon2.verify threw for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        valid = false;
      }
      if (!valid) {
        throw new UnauthorizedException({
          code: 'AUTH_WRONG_PASSWORD',
          message: this.i18n.t('auth.password_wrong'),
        });
      }
    } else if (dto.code) {
      const email = user.email ? normalizeEmail(user.email) : null;
      if (!email) {
        badRequest(this.i18n.t('auth.email_required_for_delete_account'));
      }
      await this.verificationCodeService.verify(
        email,
        dto.code,
        'delete-account',
      );
    } else {
      badRequest(this.i18n.t('auth.provide_password_or_code_for_deletion'));
    }

    await this.accountRepository.softDeleteUser(userId, now());
  }
}
