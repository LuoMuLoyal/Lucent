import { Prisma } from '#generated/prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { DailyRecordKind } from '#generated/prisma/client';

const _dailyRecordAttachmentSelect = {
  id: true,
  kind: true,
  objectKey: true,
  bucket: true,
  provider: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  publicUrl: true,
  createdAt: true,
} satisfies Prisma.UserDailyRecordAttachmentSelect;

export type DailyRecordAttachmentShape =
  Prisma.UserDailyRecordAttachmentGetPayload<{
    select: typeof _dailyRecordAttachmentSelect;
  }>;

export type DailyRecordDbClient = Pick<
  PrismaService,
  'userDailyRecord' | 'userDailyRecordAttachment'
>;

export const dailyRecordWithAttachments = {
  attachments: {
    orderBy: { createdAt: Prisma.SortOrder.asc },
  },
} satisfies Prisma.UserDailyRecordInclude;

export type DailyRecordShape = Prisma.UserDailyRecordGetPayload<{
  include: typeof dailyRecordWithAttachments;
}>;

export type OwnedRecordSnapshot = {
  kind: DailyRecordKind;
  payload: unknown;
  occurredAt?: Date | undefined;
};
