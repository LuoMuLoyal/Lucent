/**
 * Medical QA chunk admin contract (`application/ports`).
 *
 * The `medical_qa_chunks` corpus is the assistant's own retrieval source — it
 * is what the LightRAG `qa` workspace is built from, and the assistant is the
 * only runtime consumer. Editorial access belongs here, with the owner of the
 * corpus, not with the module that happens to expose an admin endpoint.
 *
 * Write path outside the console: `scripts/import/medicine/import-medical-qa.ts`
 * (bare `pg`, not Nest DI). Implemented against Prisma in
 * `infrastructure/persistence/qa-chunks.ts`.
 */

export const ASSISTANT_QA_CHUNK_REPOSITORY = 'ASSISTANT_QA_CHUNK_REPOSITORY';

export interface QaChunkAdminInput {
  question: string;
  answer: string;
  safetyLabel: string;
}

export type QaChunkAdminPatch = {
  [Key in keyof QaChunkAdminInput]?: QaChunkAdminInput[Key] | undefined;
};

export interface QaChunkAdminListQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  safetyLabel?: string | undefined;
}

export interface QaChunkEditableRow {
  id: string;
  qaId: string;
  question: string;
  answer: string;
  safetyLabel: string;
}

export interface QaChunkAdminRow extends QaChunkEditableRow {
  updatedAt: string;
}

export interface QaChunkRepositoryPort {
  list(
    query: QaChunkAdminListQuery,
  ): Promise<{ items: QaChunkAdminRow[]; total: number }>;
  findEditable(id: string): Promise<QaChunkEditableRow | null>;
  update(id: string, patch: QaChunkAdminPatch): Promise<QaChunkAdminRow | null>;
}
