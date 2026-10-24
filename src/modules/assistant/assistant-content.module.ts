import { Module } from '@nestjs/common';

import { ASSISTANT_QA_CHUNK_REPOSITORY } from './application/ports/qa-chunks.js';
import { QaChunksAdminService } from './application/use_cases/qa-chunks-admin.js';
import { AssistantQaChunksRepository } from './infrastructure/persistence/qa-chunks.js';

/**
 * Content-admin capability of the assistant context, split out of
 * `AssistantModule` on purpose.
 *
 * `AssistantModule` imports `DailyRecordsModule` → `HealthEventsModule` →
 * `ProductEventsModule` → `AdminModule`. The admin console is the only
 * consumer of the QA-corpus editorial surface, so registering it in
 * `AssistantModule` made `admin` import a graph that imports `admin` back —
 * a genuine module cycle, not a theoretical one (it showed up as two new
 * `no-circular` observations the moment `AdminModule` imported
 * `AssistantModule`).
 *
 * This module declares exactly the editorial surface and nothing else, so
 * `admin` can depend on the capability without pulling in the assistant's
 * runtime graph. Both `PrismaModule` and `AuditLogModule` are `@Global`, so
 * no `imports` are needed.
 *
 * The name follows the sub-topic convention already used by
 * `admin-metrics.module.ts`.
 */
@Module({
  providers: [
    AssistantQaChunksRepository,
    QaChunksAdminService,
    {
      provide: ASSISTANT_QA_CHUNK_REPOSITORY,
      useExisting: AssistantQaChunksRepository,
    },
  ],
  exports: [QaChunksAdminService],
})
export class AssistantContentModule {}
