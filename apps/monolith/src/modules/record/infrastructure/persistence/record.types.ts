import { Prisma } from '#generated/prisma/client.js';
import type { PrismaService } from '../../../../prisma/index.js';
import type { RecordKind } from '#generated/prisma/client.js';

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
} satisfies Prisma.UserRecordAttachmentSelect;

export type DailyRecordAttachmentShape =
  Prisma.UserRecordAttachmentGetPayload<{
    select: typeof _dailyRecordAttachmentSelect;
  }>;

export type DailyRecordDbClient = Pick<
  PrismaService,
  'userRecord' | 'userRecordAttachment'
>;

export const dailyRecordWithAttachments = {
  attachments: {
    orderBy: { createdAt: Prisma.SortOrder.asc },
  },
} satisfies Prisma.UserRecordInclude;

export type DailyRecordShape = Prisma.UserRecordGetPayload<{
  include: typeof dailyRecordWithAttachments;
}>;

export type OwnedRecordSnapshot = {
  kind: RecordKind;
  payload: unknown;
  occurredAt?: Date | undefined;
};
