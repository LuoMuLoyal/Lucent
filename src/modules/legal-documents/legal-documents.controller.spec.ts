import { Test, type TestingModule } from '@nestjs/testing';
import { errAsync, okAsync } from '../../common/result/index.js';
import type { DomainFailure } from '../../common/result/index.js';
import { LegalDocumentsController } from './legal-documents.controller.js';
import { LegalDocumentsService } from './services/documents.service.js';

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
            findAll: vi.fn(),
            findOne: vi.fn(),
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
    it('returns the document list resource', async () => {
      vi.mocked(service.findAll).mockReturnValue(okAsync(mockListData));

      const result = await controller.findAll({});

      expect(result).toEqual(mockListData);
      expect(service.findAll).toHaveBeenCalledWith({});
    });

    it('passes lang query to service', async () => {
      vi.mocked(service.findAll).mockReturnValue(okAsync(mockListData));

      await controller.findAll({ lang: 'en' });

      expect(service.findAll).toHaveBeenCalledWith({ lang: 'en' });
    });

    it('folds a service Err into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'not_found',
        code: 'LEGAL_DOCUMENT_NOT_FOUND',
      };
      vi.mocked(service.findAll).mockReturnValue(errAsync(failure));

      await expect(controller.findAll({})).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: expect.objectContaining({ code: 'LEGAL_DOCUMENT_NOT_FOUND' }),
      });
    });
  });

  describe('findOne', () => {
    it('returns the document detail resource', async () => {
      vi.mocked(service.findOne).mockReturnValue(okAsync(mockDetailData));

      const result = await controller.findOne('terms', {});

      expect(result).toEqual(mockDetailData);
      expect(service.findOne).toHaveBeenCalledWith('terms', {});
    });

    it('passes docType and lang to service', async () => {
      vi.mocked(service.findOne).mockReturnValue(okAsync(mockDetailData));

      await controller.findOne('privacy', { lang: 'en' });

      expect(service.findOne).toHaveBeenCalledWith('privacy', { lang: 'en' });
    });

    it('folds LEGAL_DOCUMENT_NOT_FOUND into a DomainFailureException', async () => {
      const failure: DomainFailure = {
        _tag: 'DomainFailure',
        kind: 'not_found',
        code: 'LEGAL_DOCUMENT_NOT_FOUND',
      };
      vi.mocked(service.findOne).mockReturnValue(errAsync(failure));

      await expect(controller.findOne('nonexistent', {})).rejects.toMatchObject(
        {
          name: 'DomainFailureException',
          failure: expect.objectContaining({
            code: 'LEGAL_DOCUMENT_NOT_FOUND',
          }),
        },
      );
    });
  });
});
