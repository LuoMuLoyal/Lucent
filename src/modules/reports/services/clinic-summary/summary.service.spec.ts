import { createHash } from 'node:crypto';
import type { DeepMocked } from '../../../../common/types/deep-mocked';
import type { ConfigService } from '@nestjs/config';
import { ClinicSummaryService } from './summary.service';
import type { ClinicSummaryPdfService } from './pdf.service';
import type { PrismaService } from '../../../../prisma/prisma.service';

describe('ClinicSummaryService', () => {
  let service: ClinicSummaryService;
  let prisma: DeepMocked<PrismaService>;
  let cacheManager: { get: vi.Mock; set: vi.Mock };
  let pdfService: vi.Mocked<ClinicSummaryPdfService>;
  let configService: vi.Mocked<ConfigService>;

  beforeEach(() => {
    prisma = {
      user: {
        findFirstOrThrow: vi.fn(),
      },
    } as unknown as DeepMocked<PrismaService>;

    cacheManager = {
      get: vi.fn(),
      set: vi.fn(),
    };

    pdfService = {
      buildPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    } as unknown as vi.Mocked<ClinicSummaryPdfService>;

    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;

    service = new ClinicSummaryService(
      prisma,
      cacheManager as never,
      pdfService,
      configService,
    );
  });

  const mockUserRow = {
    nickname: '张三',
    profile: {
      birthDate: new Date('2000-01-15'),
      sexAtBirth: 'male',
      bloodType: 'A',
    },
    allergies: [
      { label: '青霉素', reaction: '皮疹', severity: 'moderate' },
      { label: '海鲜', reaction: null, severity: 'mild' },
    ],
    conditions: [
      {
        label: '高血压',
        status: 'active',
        diagnosedAt: new Date('2023-06-01'),
      },
    ],
    currentMedicines: [{ displayName: '氨氯地平片', doseText: '5mg 每日一次' }],
  };

  describe('buildClinicSummary', () => {
    it('builds summary with de-identified profile', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await service.buildClinicSummary('user-1');

      expect(result.profile.nickname).toBe('张**');
      expect(result.profile.age).toBeGreaterThan(0);
      expect(result.profile.sexAtBirth).toBe('male');
      expect(result.profile.bloodType).toBe('A');
      expect(result.allergies).toHaveLength(2);
      expect(result.allergies[0]!.label).toBe('青霉素');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]!.diagnosedYear).toBe(2023);
      expect(result.currentMedicines).toHaveLength(1);
      expect(result.dataRange).toBe('last_30_days');
      expect(result.disclaimer).toContain('此摘要');
    });

    it('handles null profile', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        profile: null,
      });

      const result = await service.buildClinicSummary('user-1');

      expect(result.profile.age).toBeNull();
      expect(result.profile.sexAtBirth).toBeNull();
      expect(result.profile.bloodType).toBeNull();
    });

    it('handles null nickname', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: null,
      });

      const result = await service.buildClinicSummary('user-1');
      expect(result.profile.nickname).toBe('匿名用户');
    });

    it('handles single-character nickname', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: 'A',
      });

      const result = await service.buildClinicSummary('user-1');
      expect(result.profile.nickname).toBe('A');
    });

    it('handles empty allergies and conditions', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

      const result = await service.buildClinicSummary('user-1');
      expect(result.allergies).toHaveLength(0);
      expect(result.conditions).toHaveLength(0);
      expect(result.currentMedicines).toHaveLength(0);
    });
  });

  describe('createShareLink', () => {
    it('creates share link with cache and returns URL', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue({ publicBaseUrl: 'https://lumos.app' });

      const result = await service.createShareLink('user-1');

      expect(result.shareUrl).toContain('https://lumos.app');
      expect(result.shareUrl).toContain(
        '/api/v1/reports/clinic-summary/shared/',
      );
      expect(result.expiresAt).toBeDefined();
      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining('clinic-share:'),
        expect.any(Object),
        expect.any(Number),
      );
    });

    it('falls back to localhost when config missing', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue(undefined);

      const result = await service.createShareLink('user-1');

      expect(result.shareUrl).toContain('localhost:3000');
    });
  });

  describe('getSharedSummary', () => {
    it('returns cached summary when found', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.getSharedSummary('some-token');

      expect(result).toEqual(cached);
      expect(cacheManager.get).toHaveBeenCalledWith(
        `clinic-share:${createHash('sha256').update('some-token').digest('hex')}`,
      );
    });

    it('returns null when not found in cache', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.getSharedSummary('missing-token');

      expect(result).toBeNull();
    });
  });

  describe('exportPdf', () => {
    it('builds summary and generates PDF', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await service.exportPdf('user-1', 'zh-CN');

      expect(pdfService.buildPdf).toHaveBeenCalledWith(
        expect.objectContaining({ profile: expect.any(Object) }),
        'zh-CN',
      );
      expect(result).toEqual(Buffer.from('pdf-bytes'));
    });
  });

  describe('exportSharedPdf', () => {
    it('returns null when shared summary not found', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.exportSharedPdf('missing', 'zh-CN');

      expect(result).toBeNull();
      expect(pdfService.buildPdf).not.toHaveBeenCalled();
    });

    it('generates PDF from cached shared summary', async () => {
      const cached = {
        generatedAt: '2026-07-10',
        dataRange: 'last_30_days',
        profile: {
          nickname: 'Test',
          age: 25,
          sexAtBirth: 'male',
          bloodType: 'A',
        },
        allergies: [],
        conditions: [],
        currentMedicines: [],
        disclaimer: 'test',
      };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.exportSharedPdf('valid-token', 'en');

      expect(pdfService.buildPdf).toHaveBeenCalledWith(cached, 'en');
      expect(result).toEqual(Buffer.from('pdf-bytes'));
    });
  });

  describe('de-identification (maskName)', () => {
    it('masks multi-character names to first char + **', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: '张三丰',
      });

      const result = await service.buildClinicSummary('user-1');
      expect(result.profile.nickname).toBe('张**');
    });

    it('returns 匿名用户 for null name', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: null,
      });

      const result = await service.buildClinicSummary('user-1');
      expect(result.profile.nickname).toBe('匿名用户');
    });
  });
});
