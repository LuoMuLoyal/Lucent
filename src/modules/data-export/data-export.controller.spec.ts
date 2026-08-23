import { Test, type TestingModule } from '@nestjs/testing';
import { errAsync, okAsync } from '../../common/result';
import type { DomainFailure } from '../../common/result';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './services/export.service';
import type {
  CreateDataExportRequestDto,
  DataExportRequestDataDto,
} from './dto/export-response.dto';

describe('DataExportController', () => {
  let controller: DataExportController;
  let service: vi.Mocked<DataExportService>;

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
      ],
    }).compile();

    controller = module.get(DataExportController);
    service = module.get(DataExportService);
  });

  it('should create a data export request', async () => {
    const exportReq = makeExportRequest();
    service.createRequest.mockReturnValue(okAsync(exportReq));
    const dto: CreateDataExportRequestDto = {
      kind: 'hospital',
      format: 'pdf',
      range: 'last_7_days',
      password: 'Passw0rd123',
    };

    const result = await controller.createRequest(
      {
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      },
      dto,
      'zh-CN',
    );

    expect(result).toBeDefined();
    expect(result.status).toBe('requested');
    expect(service.createRequest).toHaveBeenCalledWith('u1', dto, 'zh-CN');
  });

  it('folds a service Err into a DomainFailureException', async () => {
    const failure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
    };
    service.createRequest.mockReturnValue(errAsync(failure));

    await expect(
      controller.createRequest(
        {
          sub: 'u1',
          email: 'a@b.c',
          status: 'active',
        },
        {
          kind: 'hospital',
          format: 'pdf',
          range: 'last_7_days',
          password: 'Passw0rd123',
        },
        'zh-CN',
      ),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }),
    });
  });

  it('should return the latest export request', async () => {
    const exportReq = makeExportRequest({ status: 'processing' });
    service.getLatestRequest.mockReturnValue(okAsync(exportReq));

    const result = await controller.getLatestRequest({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

    expect(result).toBeDefined();
    expect(result?.status).toBe('processing');
    expect(service.getLatestRequest).toHaveBeenCalledWith('u1');
  });

  it('should return null data when no export request exists', async () => {
    service.getLatestRequest.mockReturnValue(okAsync(null));

    const result = await controller.getLatestRequest({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

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
