/**
 * Persistence: `LayoutRepository` on top of `Layout`.
 *
 * ## Why the unique constraint is the concurrency backstop
 *
 * The use case settles `ifVersion` against the row it just read, but two
 * requests can both read version 3 and both decide to write 4. The database
 * cannot stop that (both are valid updates to the same row), *except* on the
 * first write for a surface: there the `(userId, surface)` unique constraint
 * turns the loser's `create` into a P2002.
 *
 * That P2002 is mapped to `LAYOUT_VERSION_CONFLICT` rather than the generic
 * `RESOURCE_CONFLICT` — from the client's point of view it means exactly what a
 * version mismatch means: someone else got there first, re-read and retry.
 *
 * ## Prisma types stay here
 *
 * The domain sees `LayoutState` / `LayoutWrite`; `Prisma.JsonValue` never
 * crosses the port boundary. That is what lets the aggregate be unit-tested
 * with hand-built values (ADR-0024 §4).
 */

import { Injectable } from '@nestjs/common';

import { Prisma } from '#generated/prisma/client.js';
import { mapPrismaKnownRequestError } from '../../../../common/helpers/prisma/prisma-result.utils.js';
import { createDomainFailure } from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import type { LayoutPayload, LayoutState } from '../../domain/layout/layout.js';
import { LayoutRepository } from '../../domain/layout/layouts.js';
import type { LayoutWrite } from '../../domain/layout/layouts.js';
import type { LayoutSurface } from '../../domain/layout/surface.js';

/** Shape of the columns this repository reads; keeps the mapper total. */
interface LayoutRow {
  surface: string;
  version: number;
  schemaVersion: number;
  payload: Prisma.JsonValue;
  updatedAt: Date;
}

@Injectable()
export class PrismaLayouts extends LayoutRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByUser(userId: string): Promise<LayoutState[]> {
    const rows = await this.prisma.layout.findMany({
      where: { userId },
      select: {
        surface: true,
        version: true,
        schemaVersion: true,
        payload: true,
        updatedAt: true,
      },
    });
    return rows.map(toState);
  }

  async findOne(
    userId: string,
    surface: LayoutSurface,
  ): Promise<LayoutState | null> {
    const row = await this.prisma.layout.findUnique({
      where: { userId_surface: { userId, surface } },
      select: {
        surface: true,
        version: true,
        schemaVersion: true,
        payload: true,
        updatedAt: true,
      },
    });
    return row == null ? null : toState(row);
  }

  async upsert(write: LayoutWrite): Promise<LayoutState> {
    try {
      const row = await this.prisma.layout.upsert({
        where: {
          userId_surface: { userId: write.userId, surface: write.surface },
        },
        create: {
          userId: write.userId,
          surface: write.surface,
          version: write.version,
          schemaVersion: write.schemaVersion,
          payload: write.payload as Prisma.InputJsonValue,
        },
        update: {
          version: write.version,
          schemaVersion: write.schemaVersion,
          payload: write.payload as Prisma.InputJsonValue,
        },
        select: {
          surface: true,
          version: true,
          schemaVersion: true,
          payload: true,
          updatedAt: true,
        },
      });
      return toState(row);
    } catch (error) {
      // Two first writes racing for the same (userId, surface): the loser hits
      // the unique constraint. That is a version conflict from the client's
      // perspective, not a generic resource conflict.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DomainFailureException(
          createDomainFailure({
            kind: 'conflict',
            code: 'LAYOUT_VERSION_CONFLICT',
            cause: error,
          }),
        );
      }
      const failure = mapPrismaKnownRequestError(error);
      if (failure != null) {
        throw new DomainFailureException(failure);
      }
      throw error;
    }
  }
}

/**
 * Maps a stored row to the domain value.
 *
 * The `surface` column is a plain string in the database, so it may hold a
 * value this build does not know (a newer client wrote it, or the row predates
 * a rename). Such rows are dropped at read time by the use case rather than
 * guessed here — `fromRow` keeps the raw string and lets the caller decide.
 */
function toState(row: LayoutRow): LayoutState {
  return {
    surface: row.surface as LayoutSurface,
    version: row.version,
    schemaVersion: row.schemaVersion,
    payload: asPayload(row.payload),
    updatedAt: row.updatedAt,
  };
}

/**
 * `Prisma.JsonValue` is already the domain's opaque payload type.
 *
 * No narrowing happens here on purpose: the server does not know whether a
 * given surface's document is an object (page layouts) or an array
 * (`tab_chrome`), and deciding would mean teaching storage about layout
 * semantics. The column is `jsonb NOT NULL`, so the only alternative is `null`,
 * which the request schema refuses — nothing to sanitise.
 */
function asPayload(value: Prisma.JsonValue): LayoutPayload {
  return value;
}
