import { okAsync } from '../../../../common/result/index.js';
import type { AuditLogService } from '../../../audit-log/index.js';
import type {
  QaChunkAdminRow,
  QaChunkEditableRow,
  QaChunkRepositoryPort,
} from '../ports/qa-chunks.js';
import { QaChunksAdminService } from './qa-chunks-admin.js';

/**
 * Orchestration tests for the QA-corpus content-admin use case.
 *
 * The corpus is the assistant's own retrieval source, so the editorial
 * surface is tested here rather than in the module that merely exposes the
 * admin endpoint. The service depends on a repository port, so these tests
 * speak to the port and only assert the use-case responsibilities: the page
 * window echoed back, filter pass-through, and the audit journaling of
 * before/after summaries.
 */
describe('QaChunksAdminService', () => {
  const chunkRow: QaChunkAdminRow = {
    id: 'chunk-1',
    qaId: 'Q-1',
    question: '高血压怎么预防？',
    answer: '低盐饮食、规律运动、控制体重。',
    safetyLabel: 'safe',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const editableRow: QaChunkEditableRow = {
    id: 'chunk-1',
    qaId: 'Q-1',
    question: '高血压怎么预防？',
    answer: '低盐饮食、规律运动、控制体重。',
    safetyLabel: 'safe',
  };

  function buildService() {
    const chunks = {
      list: vi.fn(),
      findEditable: vi.fn(),
      update: vi.fn(),
    };
    const audit = { log: vi.fn().mockReturnValue(okAsync(undefined)) };
    return {
      service: new QaChunksAdminService(
        audit as unknown as AuditLogService,
        chunks as unknown as QaChunkRepositoryPort,
      ),
      chunks,
      audit,
    };
  }

  it('echoes the requested page window around the repository page', async () => {
    const { service, chunks } = buildService();
    chunks.list.mockResolvedValue({ items: [chunkRow], total: 1 });

    const listed = await service.list({ page: 2, limit: 10 });

    expect(listed).toEqual({
      items: [chunkRow],
      total: 1,
      page: 2,
      limit: 10,
    });
    expect(chunks.list).toHaveBeenCalledWith({ page: 2, limit: 10 });
  });

  it('passes the search and label filters through to the repository', async () => {
    const { service, chunks } = buildService();
    chunks.list.mockResolvedValue({ items: [], total: 0 });

    await service.list({
      page: 1,
      limit: 25,
      q: '高血压',
      safetyLabel: 'safe',
    });

    expect(chunks.list).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      q: '高血压',
      safetyLabel: 'safe',
    });
  });

  it('updates only the supplied fields and records before/after summaries', async () => {
    const { service, chunks, audit } = buildService();
    const updated = { ...chunkRow, safetyLabel: 'blocked' };
    chunks.findEditable.mockResolvedValue(editableRow);
    chunks.update.mockResolvedValue(updated);

    await expect(
      service.update('actor-1', 'chunk-1', { safetyLabel: 'blocked' }),
    ).resolves.toEqual(updated);
    expect(chunks.update).toHaveBeenCalledWith('chunk-1', {
      safetyLabel: 'blocked',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.content.qa_chunk.update',
        resourceType: 'medical_qa_chunk',
        resourceId: 'chunk-1',
        metadata: { before: editableRow, after: updated },
      }),
    );
  });

  it('returns null without auditing when the chunk is unknown', async () => {
    const { service, chunks, audit } = buildService();
    chunks.findEditable.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'missing', { question: 'changed' }),
    ).resolves.toBeNull();
    expect(chunks.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('returns null when the row vanishes between the read and the write', async () => {
    const { service, chunks, audit } = buildService();
    chunks.findEditable.mockResolvedValue(editableRow);
    chunks.update.mockResolvedValue(null);

    await expect(
      service.update('actor-1', 'chunk-1', { question: 'changed' }),
    ).resolves.toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
