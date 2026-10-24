/**
 * Medical QA chunk admin contract (`application/ports`).
 *
 * Editorial surface over the assistant's `medical_qa_chunks` corpus for the
 * content admin console. Implemented in
 * `infrastructure/persistence/qa-chunks.ts`.
 */

export const MEDICINE_QA_CHUNK_REPOSITORY = 'MEDICINE_QA_CHUNK_REPOSITORY';

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
