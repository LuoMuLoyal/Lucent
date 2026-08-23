import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

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
import { VerificationCodeService } from './identity/verification-code.service';
import { AuthAccountRepositoryPort } from '../repositories/account.repository';

@Injectable()
export class AuthAccountService {
  private readonly logger = new Logger(AuthAccountService.name);

  constructor(
    private readonly accountRepository: AuthAccountRepositoryPort,
    private readonly userService: UserService,
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
        if (!user.passwordHash) {
          return errAsync(
            createDomainFailure({
              kind: 'authentication',
              code: 'AUTH_WRONG_PASSWORD',
            }),
          );
        }
        return this.verifyPasswordForDeletion(
          userId,
          user,
          dto.password,
        ).andThen(() => this.accountRepository.softDeleteUser(userId, now()));
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

  private verifyPasswordForDeletion(
    userId: string,
    user: User,
    password: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      argon2.verify(user.passwordHash as string, password),
      (error) => {
        // A thrown Argon2 failure (corrupted hash, native binding error,
        // module misconfiguration) is re-thrown so it surfaces as a
        // dependency/internal error — never misreported as a wrong password.
        // The underlying error is logged so infrastructure issues are not
        // silently masked.
        this.logger.warn(
          `argon2.verify threw for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      },
    ).andThen((valid) => {
      if (!valid) {
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        );
      }
      return okAsync(undefined);
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
