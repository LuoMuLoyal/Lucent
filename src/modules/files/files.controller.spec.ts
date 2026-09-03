import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/index.js';
import { errAsync, okAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './services/files.service.js';

describe('FilesController', () => {
  let controller: FilesController;
  let filesService: vi.Mocked<Pick<FilesService, 'createPresignedUpload'>>;

  const mockResult = {
    provider: 'tencent-cos',
    bucket: 'test-bucket',
    objectKey: 'files/user-1/test.jpg',
    uploadUrl: 'https://signed.example.com',
    headers: { 'Content-Type': 'image/jpeg' },
    publicUrl: 'https://cdn.example.com/files/user-1/test.jpg',
    expiresAt: '2026-01-01T00:00:00.000Z',
    maxSizeBytes: 10_485_760,
  };

  const dto = {
    contentType: 'image/jpeg',
    sizeBytes: 204800,
    fileName: 'photo.jpg',
  };

  const user = { sub: 'user-1', email: 'test@example.com', status: 'active' };

  beforeEach(async () => {
    filesService = {
      createPresignedUpload: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [{ provide: FilesService, useValue: filesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FilesController>(FilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call filesService.createPresignedUpload and return the resource', async () => {
    filesService.createPresignedUpload.mockReturnValue(okAsync(mockResult));

    const result = await controller.createUpload(user, dto);

    expect(filesService.createPresignedUpload).toHaveBeenCalledWith(
      'user-1',
      dto,
    );
    expect(result).toEqual(mockResult);
  });

  it('should fold a VALIDATION_FAILED Err into a DomainFailureException', async () => {
    const failure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    };
    filesService.createPresignedUpload.mockReturnValue(errAsync(failure));

    await expect(controller.createUpload(user, dto)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    });
  });

  it('should fold a DEPENDENCY_UNAVAILABLE Err from the service', async () => {
    const failure: DomainFailure = {
      _tag: 'DomainFailure',
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
    };
    filesService.createPresignedUpload.mockReturnValue(errAsync(failure));

    await expect(controller.createUpload(user, dto)).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: expect.objectContaining({ code: 'DEPENDENCY_UNAVAILABLE' }),
    });
  });
});
