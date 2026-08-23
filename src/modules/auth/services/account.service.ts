import { Injectable } from '@nestjs/common';

import { User } from '#generated/prisma/client';
import { normalizeEmail, now } from '../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { UserService } from '../../user';
import { DeleteAccountDto } from '../dto/shared/delete-account.dto';
import { PasswordReauthService } from './identity/password-reauth.service';
import { VerificationCodeService } from './identity/verification-code.service';
import { AuthAccountRepositoryPort } from '../repositories/account.repository';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly accountRepository: AuthAccountRepositoryPort,
    private readonly userService: UserService,
    private readonly passwordReauthService: PasswordReauthService,
    private readonly verificationCodeService: VerificationCodeService,
  ) {}

  getActiveUser(userId: string): ResultAsync<User, DomainFailure> {
    return this.lift(this.userService.findById(userId)).andThen((user) => {
      if (!user) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return okAsync(user);
    });
  }

  deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): ResultAsync<void, DomainFailure> {
    return this.getActiveUser(userId).andThen((user) => {
      if (dto.password) {
        return this.passwordReauthService
          .verify(userId, dto.password)
          .andThen(() => this.accountRepository.softDeleteUser(userId, now()));
      }

      if (dto.code) {
        const email = user.email ? normalizeEmail(user.email) : null;
        if (!email) {
          return errAsync(
            createDomainFailure({
              kind: 'validation',
              code: 'VALIDATION_FAILED',
            }),
          );
        }
        return this.verificationCodeService
          .verify(email, dto.code, 'delete-account')
          .andThen(() => this.accountRepository.softDeleteUser(userId, now()));
      }

      return errAsync(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
        }),
      );
    });
  }

  /**
   * Lifts non-Prisma IO into `ResultAsync`. Unknown exceptions and
   * dependency-level failures are re-thrown, never converted into a
   * DomainFailure.
   */
  private lift<T>(promise: Promise<T>): ResultAsync<T, DomainFailure> {
    return fromPromise(promise, (error) => {
      throw error;
    });
  }
}
