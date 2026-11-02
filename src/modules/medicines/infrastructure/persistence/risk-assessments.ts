import { Injectable } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { toInputJsonValue } from '../../../../common/index.js';
import type {
  RiskAssessmentRecord,
  RiskAssessmentStore,
  RiskAssessmentTransaction,
} from '../../domain/safety/risk-assessments.js';
import type { RiskAssessment } from '../../domain/safety/risk-assessment.js';

/** Prisma's `check_type` column is a free string; the domain narrows it. */
function asCheckType(value: string): 'static' | 'llm' {
  return value === 'llm' ? 'llm' : 'static';
}

/**
 * Prisma-backed implementation of the `RiskAssessment` aggregate store
 * (`domain/safety/risk-assessments.ts`).
 *
 * ## Write side only
 *
 * ADR-0024 §4: one repository per aggregate root, load/save for writes. The
 * read path (`GET risk-check` latest records) keeps using
 * `MEDICINE_RISK_RECORDS` — that is a read-model port, not this store. The
 * write method that used to live on the read port (`upsertRecord`) is gone from
 * the port definition, so the two-track write cannot come back by accident.
 *
 * ## Transaction
 *
 * `save` accepts the caller's Prisma transaction client so an aggregate write
 * and an outbox append can share one transaction. The domain declares the
 * handle as opaque (`RiskAssessmentTransaction`); it is narrowed to
 * `Prisma.TransactionClient` right here, which keeps Prisma out of `domain/`.
 *
 * Upsert follows the table's `@@unique([userId, checkType])`: a user has at most
 * one static and one LLM assessment, so "save" means "replace the current one".
 * The aggregate itself is immutable after completion — there is deliberately no
 * partial-update path.
 */
@Injectable()
export class PrismaRiskAssessmentStore implements RiskAssessmentStore {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    assessment: RiskAssessment,
    tx?: RiskAssessmentTransaction,
  ): Promise<RiskAssessmentRecord> {
    const client = (tx as Prisma.TransactionClient | undefined) ?? this.prisma;
    const payload = {
      result: toInputJsonValue(assessment.result),
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskLevel,
    };

    const row = await client.medicineRiskCheckRecord.upsert({
      where: {
        userId_checkType: {
          userId: assessment.userId,
          checkType: assessment.checkType,
        },
      },
      create: {
        userId: assessment.userId,
        checkType: assessment.checkType,
        ...payload,
        stale: false,
      },
      update: { ...payload, stale: false },
    });

    return toRecord(row);
  }

  async findByUser(userId: string): Promise<RiskAssessmentRecord[]> {
    const rows = await this.prisma.medicineRiskCheckRecord.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toRecord);
  }
}

type RiskCheckRow = {
  id: string;
  result: unknown;
  userId: string;
  checkType: string;
  riskScore: number;
  riskLevel: string;
  stale: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: RiskCheckRow): RiskAssessmentRecord {
  return {
    id: row.id,
    result: row.result as RiskAssessmentRecord['result'],
    userId: row.userId,
    checkType: asCheckType(row.checkType),
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    stale: row.stale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
