import type { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { LegalDocumentsService } from './services';

describe('LegalDocumentsService', () => {
  let service: LegalDocumentsService;

  const mockRows = [
    {
      id: '1',
      docType: 'terms',
      titleZh: '用户协议',
      titleEn: 'Terms of Service',
      contentZh: '# 用户协议\n\n内容',
      contentEn: '# Terms of Service\n\nContent',
      isActive: true,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T10:00:00.000Z'),
    },
    {
      id: '2',
      docType: 'privacy',
      titleZh: '隐私政策',
      titleEn: 'Privacy Policy',
      contentZh: '# 隐私政策\n\n内容',
      contentEn: '# Privacy Policy\n\nContent',
      isActive: true,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T12:00:00.000Z'),
    },
    {
      id: '3',
      docType: 'disclaimer',
      titleZh: '医疗免责声明',
      titleEn: 'Medical Disclaimer',
      contentZh: '# 医疗免责声明\n\n内容',
      contentEn: '# Medical Disclaimer\n\nContent',
      isActive: false,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-09T08:00:00.000Z'),
    },
  ];

  function createMockPrisma(rows = mockRows): PrismaService {
    const sortedActive = rows
      .filter((r) => r.isActive)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return {
      legalDocument: {
        findMany: jest.fn().mockResolvedValue(sortedActive),
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { docType: string } }) =>
            Promise.resolve(
              rows.find((r) => r.docType === where.docType) ?? null,
            ),
          ),
      },
    } as unknown as PrismaService;
  }

  beforeEach(() => {
    service = new LegalDocumentsService(createMockPrisma());
  });

  describe('findAll', () => {
    it('returns active documents with Chinese titles by default', async () => {
      const result = await service.findAll({});

      expect(result.items).toHaveLength(2);
      // sorted by updatedAt desc: privacy (12:00) before terms (10:00)
      expect(result.items[0]!.docType).toBe('privacy');
      expect(result.items[0]!.title).toBe('隐私政策');
      expect(result.items[1]!.docType).toBe('terms');
      expect(result.items[1]!.title).toBe('用户协议');
      expect(result.updatedAt).toBe('2026-07-11T12:00:00.000Z');
    });

    it('returns active documents with English titles when lang=en', async () => {
      const result = await service.findAll({ lang: 'en' });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.title).toBe('Privacy Policy');
      expect(result.items[1]!.title).toBe('Terms of Service');
    });

    it('returns items sorted by updatedAt desc', async () => {
      const result = await service.findAll({});

      expect(result.items[0]!.updatedAt).toBe('2026-07-11T12:00:00.000Z');
      expect(result.items[1]!.updatedAt).toBe('2026-07-11T10:00:00.000Z');
    });

    it('returns current timestamp when no documents exist', async () => {
      service = new LegalDocumentsService(createMockPrisma([]));
      const result = await service.findAll({});

      expect(result.items).toHaveLength(0);
      expect(result.updatedAt).toBeTruthy();
    });
  });

  describe('findOne', () => {
    it('returns Chinese content by default', async () => {
      const result = await service.findOne('terms', {});

      expect(result.docType).toBe('terms');
      expect(result.title).toBe('用户协议');
      expect(result.content).toBe('# 用户协议\n\n内容');
      expect(result.updatedAt).toBe('2026-07-11T10:00:00.000Z');
    });

    it('returns English content when lang=en', async () => {
      const result = await service.findOne('terms', { lang: 'en' });

      expect(result.title).toBe('Terms of Service');
      expect(result.content).toBe('# Terms of Service\n\nContent');
    });

    it('throws NotFoundException for unknown docType', async () => {
      await expect(service.findOne('nonexistent', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for inactive documents', async () => {
      await expect(service.findOne('disclaimer', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
