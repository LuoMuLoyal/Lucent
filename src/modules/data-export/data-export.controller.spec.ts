import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './services';
import { SecurityElevationGuard } from '../security-pin/guards';
import { SecurityPinService } from '../security-pin/services';
import type {
  CreateDataExportRequestDto,
  DataExportRequestDataDto,
} from './dto';

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
        SecurityElevationGuard,
        {
          provide: SecurityPinService,
          useValue: {
            verifyElevationToken: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(DataExportController);
    service = module.get(DataExportService);
  });

  it('should create a data export request', async () => {
    const exportReq = makeExportRequest();
    service.createRequest.mockResolvedValue(exportReq);
    const dto: CreateDataExportRequestDto = {
      kind: 'hospital',
      format: 'pdf',
      range: 'last_7_days',
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

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    expect(result.data?.status).toBe('requested');
    expect(service.createRequest).toHaveBeenCalledWith('u1', dto, 'zh-CN');
  });

  it('should return the latest export request', async () => {
    const exportReq = makeExportRequest({ status: 'processing' });
    service.getLatestRequest.mockResolvedValue(exportReq);

    const result = await controller.getLatestRequest({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeDefined();
    expect(result.data?.status).toBe('processing');
    expect(service.getLatestRequest).toHaveBeenCalledWith('u1');
  });

  it('should return null data when no export request exists', async () => {
    service.getLatestRequest.mockResolvedValue(null);

    const result = await controller.getLatestRequest({
      sub: 'u1',
      email: 'a@b.c',
      status: 'active',
    });

    expect(result.code).toBe(ResultCode.SUCCESS);
    expect(result.data).toBeNull();
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
