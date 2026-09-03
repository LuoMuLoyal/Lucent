import { Test, type TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { errAsync, okAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';
import { AuditLogService } from '../audit-log/index.js';
import { DataExportController } from './data-export.controller.js';
import { DataExportService } from './services/export.service.js';
import type {
  CreateDataExportRequestDto,
  DataExportRequestDataDto,
} from './dto/export-response.dto.js';

const mockRequest = {
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  raw: { socket: { remoteAddress: '127.0.0.1' } },
} as unknown as FastifyRequest;

const mockUser = {
  sub: 'u1',
  email: 'a@b.c',
  status: 'active' as const,
};

describe('DataExportController', () => {
  let controller: DataExportController;
  let service: vi.Mocked<DataExportService>;
  let auditLogService: vi.Mocked<AuditLogService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataExportController],
      providers: [
        {
          provide: DataExportService,
          useValue: {
            createRequest: vi.fn(),
            getLatestRequest: vi.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            logFireAndForget: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(DataExportController);
    service = module.get(DataExportService);
    auditLogService = module.get(AuditLogService);
  });

  it('should create a data export request and write audit log', async () => {
    const exportReq = makeExportRequest();
    service.createRequest.mockReturnValue(okAsync(exportReq));
    const dto: CreateDataExportRequestDto = {
      kind: 'hospital',
      format: 'pdf',
      range: 'last_7_days',
      password: 'Passw0rd123',
    };

    const result = await controller.createRequest(
      mockUser,
      dto,
      mockRequest,
      'zh-CN',
    );

    expect(result).toBeDefined();
    expect(result.status).toBe('requested');
    expect(service.createRequest).toHaveBeenCalledWith('u1', dto, 'zh-CN');
    expect(auditLogService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        action: 'data_export.request',
        resourceType: 'data_export',
        resourceId: 'export-1',
        metadata: { kind: 'hospital', format: 'pdf', range: 'last_7_days' },
      }),
    );
  });

  it('folds a service Err into a DomainFailureException and does not audit', async () => {
    const failure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
    };
    service.createRequest.mockReturnValue(errAsync(failure));

    await expect(
      controller.createRequest(
        mockUser,
        {
          kind: 'hospital',
          format: 'pdf',
          range: 'last_7_days',
          password: 'Passw0rd123',
        },
        mockRequest,
        'zh-CN',
      ),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }),
    });
    expect(auditLogService.logFireAndForget).not.toHaveBeenCalled();
  });

  it('should return the latest export request', async () => {
    const exportReq = makeExportRequest({ status: 'processing' });
    service.getLatestRequest.mockReturnValue(okAsync(exportReq));

    const result = await controller.getLatestRequest(mockUser);

    expect(result).toBeDefined();
    expect(result?.status).toBe('processing');
    expect(service.getLatestRequest).toHaveBeenCalledWith('u1');
  });

  it('should return null data when no export request exists', async () => {
    service.getLatestRequest.mockReturnValue(okAsync(null));

    const result = await controller.getLatestRequest(mockUser);

    expect(result).toBeNull();
  });
});

function makeExportRequest(
  overrides: Partial<DataExportRequestDataDto> = {},
): DataExportRequestDataDto {
  return {
    id: 'export-1',
    kind: 'hospital',
    format: 'pdf',
    range: 'last_7_days',
    status: 'requested',
    requestedAt: '2026-06-10T00:00:00.000Z',
    completedAt: null,
    downloadUrl: null,
    fileName: null,
    fileSizeBytes: null,
    errorMessage: null,
    ...overrides,
  };
}
