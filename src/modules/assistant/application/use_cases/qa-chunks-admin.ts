import { Inject, Injectable } from '@nestjs/common';
import { unwrapResult } from '../../../../common/result/index.js';
import { AuditLogService } from '../../../audit-log/index.js';
import {
  ASSISTANT_QA_CHUNK_REPOSITORY,
  type QaChunkAdminInput,
  type QaChunkAdminListQuery,
  type QaChunkAdminPatch,
  type QaChunkRepositoryPort,
} from '../ports/qa-chunks.js';

export type { QaChunkAdminInput, QaChunkAdminListQuery, QaChunkAdminPatch };

/**
 * Owner service for the assistant's open medical Q&A corpus
 * (`medical_qa_chunks`), exposed to the admin console through the
 * `content:read`/`content:write` surface.
 *
 * The corpus is this context's own retrieval source: the assistant answers
 * from the LightRAG `qa` workspace, which is built from these rows. Two
 * operational caveats the console surfaces but cannot enforce here:
 *
 * - an edit only reaches retrieval after `rebuild-lightrag-index.ts
 *   --workspace=qa` re-indexes it — rows are the fact source, the index is a
 *   projection;
 * - a re-import of the source corpus (`import-medical-qa.ts`) overwrites the
 *   row entirely, so an edit made before the next import does not survive it.
 *
 * Rows whose `safetyLabel` is `blocked` are skipped at index time, which makes
 * that field the safety brake on this corpus.
 */
@Injectable()
export class QaChunksAdminService {
  constructor(
    private readonly auditLog: AuditLogService,
    @Inject(ASSISTANT_QA_CHUNK_REPOSITORY)
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
