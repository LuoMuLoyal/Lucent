import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilesController } from './files.controller';
import { FilesService } from './services/files.service';

describe('FilesController', () => {
  let controller: FilesController;
  let filesService: jest.Mocked<Pick<FilesService, 'createPresignedUpload'>>;

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

  beforeEach(async () => {
    filesService = {
      createPresignedUpload: jest.fn().mockReturnValue(mockResult),
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

  it('should call filesService.createPresignedUpload and return success envelope', () => {
    const dto = {
      contentType: 'image/jpeg',
      sizeBytes: 204800,
      fileName: 'photo.jpg',
    };

    const user = { sub: 'user-1', email: 'test@example.com', status: 'active' };

    const result = controller.createUpload(user, dto);

    expect(filesService.createPresignedUpload).toHaveBeenCalledWith(
      'user-1',
      dto,
    );
    expect(result).toEqual({
      code: 0,
      message: '',
      data: mockResult,
    });
  });
});
