import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { I18nService } from 'nestjs-i18n';

import { User, UserStatus } from '#generated/prisma/client';
import { ResultCode } from '../../../common/api';
import { badRequest, notFound } from '../../../common/helpers/api-errors';
import { normalizeEmail } from '../../../common/helpers/string.utils';
import { now } from '../../../common/helpers/date-time.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserService } from '../../user/services/user.service';
import { DeleteAccountDto } from '../dto/delete-account.dto';
import { VerificationCodeService } from './verification-code.service';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly prisma: PrismaService,
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
          code: ResultCode.WRONG_PASSWORD,
          message: this.i18n.t('auth.use_code_for_oauth_account_deletion'),
        });
      }
      const valid = await argon2.verify(user.passwordHash, dto.password);
      if (!valid) {
        throw new UnauthorizedException({
          code: ResultCode.WRONG_PASSWORD,
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

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: now(), status: UserStatus.deleted },
    });
  }
}
