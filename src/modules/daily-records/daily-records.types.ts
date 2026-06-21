import type {
  DailyRecordAttachmentKind,
  DailyRecordKind,
} from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export type DailyRecordAttachmentShape = {
  id: string;
  kind: DailyRecordAttachmentKind;
  objectKey: string;
  bucket: string | null;
  provider: string | null;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  publicUrl: string | null;
  createdAt: Date;
};

export type DailyRecordShape = {
  id: string;
  kind: DailyRecordKind;
  occurredAt: Date;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: Prisma.JsonValue | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: DailyRecordAttachmentShape[];
};

export type DailyRecordDbClient = Pick<
  PrismaService,
  'userDailyRecord' | 'userDailyRecordAttachment'
>;

export const dailyRecordWithAttachments = {
  attachments: {
    orderBy: { createdAt: Prisma.SortOrder.asc },
  },
} satisfies Prisma.UserDailyRecordInclude;
