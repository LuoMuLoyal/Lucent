import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { now } from '../../../../common/index.js';
import { unwrapResult } from '../../../../common/result/index.js';
import { AuditLogService } from '../../../audit-log/index.js';
import {
  adminResourceSortFields,
  type AdminResource,
} from '../../constants/resource-registry.js';
import type { AdminResourceListQueryDto } from '../../application/ports/admin-data.js';

/** A Prisma result row — columns vary per resource, values are untyped. */
type ResourceRow = Record<string, unknown>;

/**
 * Structural view of a Prisma model delegate, narrowed to the operations the
 * generic data layer needs. Prisma's generated delegates have ~60 methods each
 * with model-specific argument types, so the service reaches them through a
 * single controlled cast rather than widening to `any`.
 */
interface ResourceDelegate {
  findMany(args: {
    where?: ResourceRow;
    orderBy?: unknown;
    skip?: number;
    take?: number;
  }): Promise<ResourceRow[]>;
  count(args?: { where?: ResourceRow }): Promise<number>;
  findFirst(args: { where: ResourceRow }): Promise<ResourceRow | null>;
  create(args: { data: ResourceRow }): Promise<ResourceRow>;
  update(args: { where: ResourceRow; data: ResourceRow }): Promise<ResourceRow>;
  delete(args: { where: ResourceRow }): Promise<ResourceRow>;
}

export interface AdminResourcePage {
  items: ResourceRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Generic read/write over any registered Prisma table for the admin console
 * (see `src/modules/admin/README.md`).
 *
 * Cross-module reads/writes straight against Prisma are an ADR-0009 controlled
 * exception for the admin surface; the `resource-registry` is the single place
 * that decides which columns exist, which are sensitive (`omitFields`), and
 * which are writable (`writableFields`). Writes are audited and reject any
 * undeclared column before Prisma sees it.
 */
@Injectable()
export class AdminDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(
    resource: AdminResource,
    query: AdminResourceListQueryDto,
  ): Promise<AdminResourcePage> {
    const delegate = this.delegateFor(resource);
    const where = this.buildWhere(resource, query);
    const orderBy = this.buildOrderBy(resource, query);
    const [rows, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      delegate.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.sanitize(resource, row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getOne(resource: AdminResource, id: string): Promise<ResourceRow | null> {
    const delegate = this.delegateFor(resource);
    const row = await delegate.findFirst({ where: this.rowWhere(resource, id) });
    return row === null ? null : this.sanitize(resource, row);
  }

  async create(
    actorUserId: string,
    resource: AdminResource,
    input: ResourceRow,
  ): Promise<ResourceRow> {
    this.assertWritable(resource);
    const data = this.pickWritable(resource, input);
    const delegate = this.delegateFor(resource);
    const row = await this.runWrite(() => delegate.create({ data }));
    await this.record(actorUserId, resource, 'admin.data.create', row);
    return this.sanitize(resource, row);
  }

  async update(
    actorUserId: string,
    resource: AdminResource,
    id: string,
    input: ResourceRow,
  ): Promise<ResourceRow | null> {
    this.assertWritable(resource);
    const data = this.pickWritable(resource, input);
    const delegate = this.delegateFor(resource);
    const existing = await delegate.findFirst({
      where: this.rowWhere(resource, id),
    });
    if (existing === null) return null;

    const row = await this.runWrite(() =>
      delegate.update({
        where: { [resource.idField]: id },
        data,
      }),
    );
    await this.record(actorUserId, resource, 'admin.data.update', row);
    return this.sanitize(resource, row);
  }

  async remove(
    actorUserId: string,
    resource: AdminResource,
    id: string,
  ): Promise<boolean> {
    this.assertWritable(resource);
    const delegate = this.delegateFor(resource);
    const existing = await delegate.findFirst({
      where: this.rowWhere(resource, id),
    });
    if (existing === null) return false;

    // Soft-delete tables keep the row and stamp `deletedAt` (mirrors the
    // `prisma.nonDeleted` extension the rest of the codebase reads through);
    // every other table is removed outright.
    await this.runWrite(() =>
      resource.softDelete
        ? delegate.update({
            where: { [resource.idField]: id },
            data: { deletedAt: now() },
          })
        : delegate.delete({ where: { [resource.idField]: id } }),
    );
    await this.record(actorUserId, resource, 'admin.data.delete', {
      [resource.idField]: id,
    });
    return true;
  }

  private delegateFor(resource: AdminResource): ResourceDelegate {
    const delegates = this.prisma as unknown as Record<
      string,
      ResourceDelegate | undefined
    >;
    const delegate = delegates[resource.model];
    if (delegate === undefined) {
      // Unreachable while the registry and Prisma schema agree; guards against
      // a registry entry that names a model Prisma no longer exposes.
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `Unknown resource model: ${resource.model}`,
      });
    }
    return delegate;
  }

  private rowWhere(resource: AdminResource, id: string): ResourceRow {
    const where: ResourceRow = { [resource.idField]: id };
    if (resource.softDelete) where['deletedAt'] = null;
    return where;
  }

  private buildWhere(
    resource: AdminResource,
    query: AdminResourceListQueryDto,
  ): ResourceRow {
    const where: ResourceRow = {};
    if (resource.softDelete) where['deletedAt'] = null;
    if (query.userId !== undefined && resource.filterFields.includes('userId')) {
      where['userId'] = query.userId;
    }
    const search = query.q;
    if (search !== undefined && resource.searchFields.length > 0) {
      where['OR'] = resource.searchFields.map((field) => ({
        [field]: { contains: search, mode: 'insensitive' },
      }));
    }
    return where;
  }

  private buildOrderBy(
    resource: AdminResource,
    query: AdminResourceListQueryDto,
  ): ResourceRow {
    const sortable = adminResourceSortFields(resource);
    const field = query.sort ?? 'createdAt';
    if (!sortable.includes(field)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `Cannot sort resource '${resource.key}' by '${field}'`,
      });
    }
    return { [field]: query.order };
  }

  /** Drops sensitive columns from an outbound row. */
  private sanitize(resource: AdminResource, row: ResourceRow): ResourceRow {
    if (resource.omitFields.length === 0) return row;
    const omitted = new Set(resource.omitFields);
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => !omitted.has(key)),
    );
  }

  /** Filters an inbound body to the resource's writable allowlist (default deny). */
  private pickWritable(resource: AdminResource, input: ResourceRow): ResourceRow {
    const allowed = new Set(resource.writableFields);
    const omitted = new Set(resource.omitFields);
    const data: ResourceRow = {};
    for (const [key, value] of Object.entries(input)) {
      if (omitted.has(key)) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `Field '${key}' is not available on the admin data API`,
        });
      }
      if (!allowed.has(key)) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: `Field '${key}' is not writable for resource '${resource.key}'`,
        });
      }
      data[key] = value;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Request body must contain at least one writable field',
      });
    }
    return data;
  }

  private assertWritable(resource: AdminResource): void {
    if (resource.readOnly) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Resource '${resource.key}' is read-only`,
      });
    }
  }

  private async record(
    actorUserId: string,
    resource: AdminResource,
    action: string,
    row: ResourceRow,
  ): Promise<void> {
    const id = row[resource.idField];
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action,
        resourceType: resource.key,
        // Field names only — never values, which may hold user content.
        metadata: { fields: Object.keys(row).sort() },
        ...(typeof id === 'string' ? { resourceId: id } : {}),
      }),
    );
  }

  private async runWrite<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  private translateWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new ConflictException({
          code: 'RESOURCE_CONFLICT',
          message: 'A row with these values already exists',
        });
      }
      if (error.code === 'P2025') {
        return new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Row not found',
        });
      }
      if (error.code === 'P2003') {
        return new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Related row does not exist',
        });
      }
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      return new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Invalid field value for this resource',
      });
    }
    return error instanceof Error
      ? error
      : new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Write failed',
        });
  }
}
