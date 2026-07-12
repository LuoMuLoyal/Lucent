import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './services';

describe('LegalDocumentsController', () => {
  let controller: LegalDocumentsController;
  let service: LegalDocumentsService;

  const mockListData = {
    items: [
      {
        docType: 'terms',
        title: '用户协议',
        updatedAt: '2026-07-11T10:00:00.000Z',
      },
      {
        docType: 'privacy',
        title: '隐私政策',
        updatedAt: '2026-07-11T12:00:00.000Z',
      },
    ],
    updatedAt: '2026-07-11T12:00:00.000Z',
  };

  const mockDetailData = {
    docType: 'terms',
    title: '用户协议',
    content: '# 用户协议\n\n内容',
    updatedAt: '2026-07-11T10:00:00.000Z',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LegalDocumentsController],
      providers: [
        {
          provide: LegalDocumentsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockListData),
            findOne: vi.fn().mockResolvedValue(mockDetailData),
          },
        },
      ],
    }).compile();

    controller = module.get(LegalDocumentsController);
    service = module.get(LegalDocumentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('returns success envelope with document list', async () => {
      const result = await controller.findAll({});

      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toEqual(mockListData);
      expect(service.findAll).toHaveBeenCalledWith({});
    });

    it('passes lang query to service', async () => {
      await controller.findAll({ lang: 'en' });

      expect(service.findAll).toHaveBeenCalledWith({ lang: 'en' });
    });
  });

  describe('findOne', () => {
    it('returns success envelope with document detail', async () => {
      const result = await controller.findOne('terms', {});

      expect(result.code).toBe(ResultCode.SUCCESS);
      expect(result.data).toEqual(mockDetailData);
      expect(service.findOne).toHaveBeenCalledWith('terms', {});
    });

    it('passes docType and lang to service', async () => {
      await controller.findOne('privacy', { lang: 'en' });

      expect(service.findOne).toHaveBeenCalledWith('privacy', { lang: 'en' });
    });
  });
});
