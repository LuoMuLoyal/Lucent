import { Inject, Injectable } from '@nestjs/common';
import { unwrapResult } from '../../../../common/result/index.js';
import { AuditLogService } from '../../../audit-log/index.js';
import {
  MEDICINE_QA_CHUNK_REPOSITORY,
  type QaChunkAdminInput,
  type QaChunkAdminListQuery,
  type QaChunkAdminPatch,
  type QaChunkRepositoryPort,
} from '../ports/qa-chunks.js';

/**
 * Owner service for the assistant's open medical Q&A corpus
 * (`medical_qa_chunks`), exposed to the admin console through the
 * `content:read`/`content:write` surface.
 *
 * Two operational caveats the console surfaces but cannot enforce here:
 * the corpus is retrieved through the LightRAG `qa` workspace built by
 * `scripts/import/medicine/rebuild-lightrag-index.ts`, so an edit only reaches
 * retrieval after a rebuild; and a re-import of the source corpus overwrites
 * the row. Rows whose `safetyLabel` is `blocked` are skipped at index time.
 */
@Injectable()
export class QaChunksAdminService {
  constructor(
    private readonly auditLog: AuditLogService,
    @Inject(MEDICINE_QA_CHUNK_REPOSITORY)
    private readonly qaChunkRepository: QaChunkRepositoryPort,
  ) {}

  async list(query: QaChunkAdminListQuery) {
    const { items, total } = await this.qaChunkRepository.list(query);
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async update(actorUserId: string, id: string, input: QaChunkAdminPatch) {
    const before = await this.qaChunkRepository.findEditable(id);
    if (before === null) return null;
    const chunk = await this.qaChunkRepository.update(id, input);
    if (chunk === null) return null;
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.content.qa_chunk.update',
        resourceType: 'medical_qa_chunk',
        resourceId: id,
        metadata: { before, after: chunk },
      }),
    );
    return chunk;
  }
}

/** Re-exported for the admin console surface — see `ports/qa-chunks.ts`. */
export type { QaChunkAdminInput, QaChunkAdminListQuery, QaChunkAdminPatch };
