/**
 * User read/write use cases (ADR-0024 \`application/use_cases\`).
 *
 * Thin by design: `User` is a supporting-context record with no invariants of its
 * own — uniqueness is the database's job and status transitions are the admin
 * surface's. What this class adds over the port is the module's **public write
 * vocabulary**: auth, account and the admin console call these methods, and the
 * barrel exports them, so the table keeps a single writer (ADR-0009).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User } from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { USER_REPOSITORY, type UserRepositoryPort } from '../ports/users.js';

@Injectable()
export class UserService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepositoryPort,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  /**
   * Creates a user. Unique-constraint violations surface as `RESOURCE_CONFLICT`
   * rather than an unhandled 500 — concurrent same-email registrations depend on
   * that distinction.
   */
  create(data: Prisma.UserCreateInput): ResultAsync<User, DomainFailure> {
    return this.users.create(data);
  }

  update(
    id: string,
    data: Prisma.UserUpdateInput,
  ): ResultAsync<User, DomainFailure> {
    return this.users.update(id, data);
  }

  updateByEmail(
    email: string,
    data: Prisma.UserUpdateInput,
  ): Promise<User | null> {
    return this.users.updateByEmail(email, data);
  }
}
