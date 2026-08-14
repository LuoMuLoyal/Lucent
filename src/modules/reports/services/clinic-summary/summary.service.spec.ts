import { BadRequestException } from '@nestjs/common';
import type { DeepMocked } from '../../../../common/types/deep-mocked';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client';
import { ClinicSummaryService, sharedSummaryCacheKey } from './summary.service';
import type { ClinicSummaryPdfService } from './pdf.service';
import type { PrismaService } from '../../../../prisma';
import type { ProductEventsService } from '../../../product-events';
import {
  CLINIC_SUMMARY_SECTION_KEYS,
  resolveSectionKeys,
} from './summary-view';
import type {
  ClinicSummaryDto,
  ClinicSummaryShareResponseDto,
} from '../../dto/clinic-summary-response.dto';

/**
 * TDD red-lock surface (Workstream 2, VS2-VS4 will make these real).
 *
 * Today `buildClinicSummary` / `exportPdf` / `createShareLink` accept no
 * scope or field-selection options, so the failing tests below call through
 * this widened cast. Implementing tasks own the actual signatures; these
 * casts stay local to this spec.
 */
interface ClinicSummaryOptions {
  range?: string;
  eventId?: string;
  dateFrom?: string;
  dateTo?: string;
  selectedFields?: string[];
}

interface SummaryServiceSurface {
  buildClinicSummary(
    userId: string,
    locale?: string,
    options?: ClinicSummaryOptions,
  ): Promise<ClinicSummaryDto>;
  exportPdf(
    userId: string,
    locale?: string,
    options?: ClinicSummaryOptions,
  ): Promise<Buffer>;
  createShareLink(
    userId: string,
    locale?: string,
    options?: ClinicSummaryOptions,
  ): Promise<ClinicSummaryShareResponseDto>;
}

/** Widened constructor so tests can inject the event-review source the fix
 *  (VS3) will wire in; extra runtime args are harmless today. */
function withEventReview(
  prisma: DeepMocked<PrismaService>,
  cache: { get: vi.Mock; set: vi.Mock },
  pdf: vi.Mocked<ClinicSummaryPdfService>,
  config: vi.Mocked<ConfigService>,
  eventReview: { buildCurrent: vi.Mock; buildForEvent?: vi.Mock },
): ClinicSummaryService {
  const productEvents = {
    emitServerEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProductEventsService;
  const Ctor = ClinicSummaryService as unknown as new (
    ...args: unknown[]
  ) => ClinicSummaryService;
  return new Ctor(
    prisma,
    cache,
    pdf,
    config,
    i18nMock,
    productEvents,
    eventReview,
  );
}

/** Minimal event-review read model the summary findings/coverage must reuse. */
const mockEventReview = {
  event: {
    id: 'evt-1',
    kind: 'symptom',
    title: '头痛观察',
    status: 'active',
    startedAt: '2026-08-01T08:00:00.000Z',
    endedAt: null,
    outcome: null,
    currentMedicineIds: [],
  },
  sections: {
    whatHappened: {
      state: 'available',
      facts: {
        code: 'health_event',
        arguments: { kind: 'symptom', symptomRecordCount: 1, checkInCount: 2 },
      },
    },
    keyChanges: {
      state: 'available',
      facts: {
        code: 'observed_changes',
        arguments: { water: 'up', sleep: 'stable', dose: null },
      },
    },
    completedActions: { state: 'unknown', reasonCode: 'no_completed_actions' },
    nextStep: {
      state: 'available',
      facts: { code: 'active_check_in', arguments: { hasTodayCheckIn: false } },
    },
  },
  coverage: {
    checkIns: {
      state: 'observed',
      coverage: 'partial',
      sources: ['manual'],
      observedCount: 2,
      expectedCount: null,
      windowStart: '2026-08-01T08:00:00.000Z',
      windowEnd: '2026-08-13T12:00:00.000Z',
    },
    dailyRecords: {
      state: 'observed',
      coverage: 'partial',
      sources: ['manual'],
      observedCount: 3,
      expectedCount: null,
      windowStart: '2026-08-01T08:00:00.000Z',
      windowEnd: '2026-08-13T12:00:00.000Z',
    },
    doseLogs: {
      state: 'observed',
      coverage: 'partial',
      sources: ['manual'],
      observedCount: 4,
      expectedCount: null,
      windowStart: '2026-08-01T08:00:00.000Z',
      windowEnd: '2026-08-13T12:00:00.000Z',
    },
  },
  sourceTimestamps: {
    checkIns: '2026-08-11',
    dailyRecords: '2026-08-10',
    doseLogs: '2026-08-10',
  },
  availableActions: ['check_in'],
  generatedAt: '2026-08-13T12:00:00.000Z',
};

const i18nMock = {
  t: vi.fn((key: string) => {
    if (key.includes('disclaimer')) return 'disclaimer-text';
    if (key.includes('anonymous_name')) return '匿名用户';
    if (key.includes('share_link_expired')) return 'Share link expired.';
    return key;
  }),
} as unknown as I18nService;

describe('ClinicSummaryService', () => {
  let service: ClinicSummaryService;
  let prisma: DeepMocked<PrismaService>;
  let cacheManager: { get: vi.Mock; set: vi.Mock };
  let pdfService: vi.Mocked<ClinicSummaryPdfService>;
  let configService: vi.Mocked<ConfigService>;
  let productEvents: { emitServerEvent: vi.Mock };

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

    productEvents = { emitServerEvent: vi.fn().mockResolvedValue(undefined) };

    service = new ClinicSummaryService(
      prisma,
      cacheManager as never,
      pdfService,
      configService,
      i18nMock,
      productEvents as unknown as ProductEventsService,
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

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(result.profile!.nickname).toBe('张**');
      expect(result.profile!.age).toBeGreaterThan(0);
      expect(result.profile!.sexAtBirth).toBe('male');
      expect(result.profile!.bloodType).toBe('A');
      expect(result.allergies!).toHaveLength(2);
      expect(result.allergies![0]!.label).toBe('青霉素');
      expect(result.conditions!).toHaveLength(1);
      expect(result.conditions![0]!.diagnosedYear).toBe(2023);
      expect(result.currentMedicines!).toHaveLength(1);
      expect(result.dataRange).toBe('last_30_days');
      expect(result.disclaimer).toContain('disclaimer-text');
    });

    it('handles null profile', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        profile: null,
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(result.profile!.age).toBeNull();
      expect(result.profile!.sexAtBirth).toBeNull();
      expect(result.profile!.bloodType).toBeNull();
    });

    it('handles null nickname', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: null,
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('匿名用户');
    });

    it('handles single-character nickname', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: 'A',
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('A');
    });

    it('handles empty allergies and conditions', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        allergies: [],
        conditions: [],
        currentMedicines: [],
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.allergies!).toHaveLength(0);
      expect(result.conditions!).toHaveLength(0);
      expect(result.currentMedicines!).toHaveLength(0);
    });

    // ── Workstream 2 red locks (fix owned by VS3) ─────────────────────────

    it('returns the requested 7-day range instead of hard-coded last_30_days', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await (
        service as unknown as SummaryServiceSurface
      ).buildClinicSummary('user-1', 'zh-CN', { range: 'last_7_days' });

      expect(result.dataRange).toBe('last_7_days');
    });

    it('populates findings from the active event review instead of leaving them empty', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn().mockResolvedValue(mockEventReview),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
        pdfService,
        configService,
        eventReview,
      );

      const result = await serviceWithReview.buildClinicSummary(
        'user-1',
        'zh-CN',
      );

      expect(result.findings).toBeDefined();
      expect(result.findings!.length).toBeGreaterThan(0);
    });

    it('exposes one unified water/dose/sleep coverage from the event review', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn().mockResolvedValue(mockEventReview),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
        pdfService,
        configService,
        eventReview,
      );

      const result = await serviceWithReview.buildClinicSummary(
        'user-1',
        'zh-CN',
      );
      const coverage = (
        result as unknown as { coverage?: Record<string, unknown> }
      ).coverage;

      expect(coverage).toBeDefined();
      expect(coverage!['water']).toBeDefined();
      expect(coverage!['dose']).toBeDefined();
      expect(coverage!['sleep']).toBeDefined();
    });

    it('excludes deselected fields from the preview summary', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await (
        service as unknown as SummaryServiceSurface
      ).buildClinicSummary('user-1', 'zh-CN', {
        selectedFields: ['profile', 'allergies'],
      });

      expect(result.conditions).toBeUndefined();
      expect(result.currentMedicines).toBeUndefined();
    });

    // ── Scope & date semantics (Task 3 review locks) ──────────────────────

    it('builds from the event review when eventId is supplied, event wins over dates', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn(),
        buildForEvent: vi.fn().mockResolvedValue({
          ...mockEventReview,
          event: {
            ...mockEventReview.event,
            endedAt: '2026-08-10T09:00:00.000Z',
          },
        }),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
        pdfService,
        configService,
        eventReview,
      );

      const result = await serviceWithReview.buildClinicSummary(
        'user-1',
        'zh-CN',
        {
          eventId: 'evt-1',
          dateFrom: '2026-08-01',
          dateTo: '2026-08-30',
        },
      );

      expect(eventReview.buildForEvent).toHaveBeenCalledWith('user-1', 'evt-1');
      expect(eventReview.buildCurrent).not.toHaveBeenCalled();
      expect(result.scopeLabel).toBe('头痛观察');
      expect(result.dataRange).toBe('event');
      expect(result.start).toBe('2026-08-01T08:00:00.000Z');
      expect(result.end).toBe('2026-08-10T09:00:00.000Z');
    });

    it('rejects a date pair missing one bound', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      await expect(
        (service as unknown as SummaryServiceSurface).buildClinicSummary(
          'user-1',
          'zh-CN',
          { dateFrom: '2026-08-01' },
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        (service as unknown as SummaryServiceSurface).buildClinicSummary(
          'user-1',
          'zh-CN',
          { dateTo: '2026-08-30' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a date span beyond 30 inclusive calendar days', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      // 2026-08-01..2026-08-31 = 31 inclusive calendar days > cap.
      await expect(
        (service as unknown as SummaryServiceSurface).buildClinicSummary(
          'user-1',
          'zh-CN',
          { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a 30-inclusive-day date span at the boundary with exclusive end', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await (
        service as unknown as SummaryServiceSurface
      ).buildClinicSummary('user-1', 'zh-CN', {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-30',
      });

      expect(result.scopeLabel).toBe('custom');
      expect(result.dataRange).toBe('custom');
      expect(result.start).toBe('2026-08-01T00:00:00.000Z');
      // end is the exclusive upper bound: dateTo + 1 day at 00:00 UTC.
      expect(result.end).toBe('2026-08-31T00:00:00.000Z');
    });

    it('accepts a single-day date range', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await (
        service as unknown as SummaryServiceSurface
      ).buildClinicSummary('user-1', 'zh-CN', {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-01',
      });

      expect(result.scopeLabel).toBe('custom');
      expect(result.start).toBe('2026-08-01T00:00:00.000Z');
      expect(result.end).toBe('2026-08-02T00:00:00.000Z');
    });

    it('falls back to the fixed 资料不足 code when no event review exists', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(result.findings).toEqual(['insufficient_coverage']);
      const coverage = (
        result as unknown as { coverage?: Record<string, unknown> }
      ).coverage;
      expect(coverage!['water']).toEqual(
        expect.objectContaining({
          state: 'unknown',
          coverage: 'none',
          observedCount: 0,
        }),
      );
    });

    it('falls back to 资料不足 when the event review reports no event', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn().mockResolvedValue(null),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
        pdfService,
        configService,
        eventReview,
      );

      const result = await serviceWithReview.buildClinicSummary(
        'user-1',
        'zh-CN',
      );

      expect(result.findings).toEqual(['insufficient_coverage']);
    });

    it('returns a metadata-only summary when only water/sleep/notes are selected', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await (
        service as unknown as SummaryServiceSurface
      ).buildClinicSummary('user-1', 'zh-CN', {
        selectedFields: ['water', 'sleep', 'notes'],
      });

      expect(result.profile).toBeUndefined();
      // Allergies are not a selectable share field — always present.
      expect(result.allergies).toBeDefined();
      expect(result.conditions).toBeUndefined();
      expect(result.currentMedicines).toBeUndefined();
      expect(result.selectedFields).toEqual(['allergies']);
      expect(result.scopeLabel).toBeDefined();
      expect(result.generatedAt).toBeDefined();
      expect(result.coverage).toBeDefined();
      expect(result.findings).toBeDefined();
      expect(result.disclaimer).toBeDefined();
    });
  });

  // ── Share-field → section translation (Task 3 review locks) ────────────

  describe('resolveSectionKeys', () => {
    it('maps the six share-field enum values onto the mapped sections plus the always-included allergies', () => {
      expect(
        resolveSectionKeys([
          'event_overview',
          'symptom_changes',
          'medication_slots',
          'water',
          'sleep',
          'notes',
        ]),
      ).toEqual(['profile', 'conditions', 'currentMedicines', 'allergies']);
    });

    it('maps water/sleep/notes selections to allergies only', () => {
      expect(resolveSectionKeys(['water', 'sleep', 'notes'])).toEqual([
        'allergies',
      ]);
    });

    it('passes section keys through unchanged and deduplicates', () => {
      expect(resolveSectionKeys(['profile', 'profile', 'allergies'])).toEqual([
        'profile',
        'allergies',
      ]);
    });

    it('ignores unknown values but keeps allergies', () => {
      expect(resolveSectionKeys(['unknown_field'])).toEqual(['allergies']);
    });
  });

  describe('createShareLink', () => {
    it('creates share link with cache and returns URL', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue({ publicBaseUrl: 'https://lumos.app' });

      const result = await service.createShareLink('user-1', 'zh-CN');

      expect(result.shareUrl).toContain('https://lumos.app');
      expect(result.shareUrl).toContain(
        '/api/v1/user/reports/clinic-summary/shared/',
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

      const result = await service.createShareLink('user-1', 'zh-CN');

      expect(result.shareUrl).toContain('localhost:3000');
    });

    // ── Workstream 2 red locks (fix owned by VS3/VS4) ─────────────────────

    it('builds the share URL against the actual /user public controller route', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue({ publicBaseUrl: 'https://lumos.app' });

      const result = await service.createShareLink('user-1', 'zh-CN');

      expect(result.shareUrl).toContain(
        '/api/v1/user/reports/clinic-summary/shared/',
      );
    });

    it('stores only the selected fields in the shared summary', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue({ publicBaseUrl: 'https://lumos.app' });

      await (service as unknown as SummaryServiceSurface).createShareLink(
        'user-1',
        'zh-CN',
        {
          selectedFields: ['profile', 'allergies'],
        },
      );

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining('clinic-share:'),
        expect.objectContaining({ conditions: undefined }),
        expect.any(Number),
      );
    });
  });

  describe('getSharedSummary', () => {
    it('returns cached summary when found', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      // No persisted share record (legacy pre-persistence share) → the cache
      // copy is the source of truth.
      (
        prisma as unknown as {
          userClinicSummaryShare: { findFirst: vi.Mock };
        }
      ).userClinicSummaryShare = { findFirst: vi.fn().mockResolvedValue(null) };

      const result = await service.getSharedSummary('some-token');

      expect(result).toEqual(cached);
      expect(cacheManager.get).toHaveBeenCalledWith(
        sharedSummaryCacheKey('some-token'),
      );
    });

    it('returns null when not found in cache', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.getSharedSummary('missing-token');

      expect(result).toBeNull();
    });

    // ── Workstream 2 red locks (fix owned by VS2) ─────────────────────────

    it('returns null for a revoked share even when a cached copy exists', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      const shareStore = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-1',
          revokedAt: new Date('2026-08-12T00:00:00.000Z'),
        }),
      };
      (
        prisma as unknown as { userClinicSummaryShare: typeof shareStore }
      ).userClinicSummaryShare = shareStore;

      const result = await service.getSharedSummary('revoked-token');

      expect(result).toBeNull();
    });

    it('records accessedAt and accessCount when a share is opened successfully', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      const shareStore = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          firstAccessedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };
      (
        prisma as unknown as { userClinicSummaryShare: typeof shareStore }
      ).userClinicSummaryShare = shareStore;

      const result = await service.getSharedSummary('valid-token');

      expect(result).not.toBeNull();
      expect(shareStore.updateMany).toHaveBeenCalled();
      expect(shareStore.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'share-1',
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) },
          }),
          data: expect.objectContaining({
            lastAccessedAt: expect.anything(),
            accessCount: { increment: 1 },
          }),
        }),
      );
    });

    it('returns null when the guarded access write matches no live share', async () => {
      // Revoked/expired between the read and the guarded write (count 0)
      // must deny the cached copy — the read→write race is closed.
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      const shareStore = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-1',
          userId: 'owner-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          firstAccessedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      };
      (
        prisma as unknown as { userClinicSummaryShare: typeof shareStore }
      ).userClinicSummaryShare = shareStore;

      const result = await service.getSharedSummary('racing-token');

      expect(result).toBeNull();
      expect(shareStore.updateMany).toHaveBeenCalled();
    });

    it('emits visit_summary_share_opened to the share owner after a successful open', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      const shareStore = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-1',
          userId: 'owner-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          firstAccessedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };
      (
        prisma as unknown as { userClinicSummaryShare: typeof shareStore }
      ).userClinicSummaryShare = shareStore;

      const result = await service.getSharedSummary('valid-token');

      expect(result).toEqual(cached);
      expect(productEvents.emitServerEvent).toHaveBeenCalledTimes(1);
      expect(productEvents.emitServerEvent).toHaveBeenCalledWith('owner-1', {
        name: ProductEventName.visit_summary_share_opened,
        surface: ProductEventSurface.system,
        result: ProductEventResult.success,
      });
      // Each successful open is a distinct event (accessCount increments per
      // open) — no deterministic clientEventId; the uuid default keeps opens
      // unique across reads.
      expect(
        productEvents.emitServerEvent.mock.calls[0]![1],
      ).not.toHaveProperty('clientEventId');
    });

    it('emits no open event for a legacy cache-only share (no owner to attribute)', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      (
        prisma as unknown as {
          userClinicSummaryShare: { findFirst: vi.Mock };
        }
      ).userClinicSummaryShare = { findFirst: vi.fn().mockResolvedValue(null) };

      const result = await service.getSharedSummary('legacy-token');

      expect(result).toEqual(cached);
      expect(productEvents.emitServerEvent).not.toHaveBeenCalled();
    });

    it('emits no open event when the guarded access write is denied', async () => {
      const cached = { generatedAt: '2026-07-10', dataRange: 'last_30_days' };
      cacheManager.get.mockResolvedValue(cached);
      const shareStore = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'share-1',
          userId: 'owner-1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          firstAccessedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      };
      (
        prisma as unknown as { userClinicSummaryShare: typeof shareStore }
      ).userClinicSummaryShare = shareStore;

      const result = await service.getSharedSummary('racing-token');

      expect(result).toBeNull();
      expect(productEvents.emitServerEvent).not.toHaveBeenCalled();
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

    // ── Workstream 2 red lock (fix owned by VS3) ──────────────────────────

    it('passes only the selected fields to the PDF builder', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      await (service as unknown as SummaryServiceSurface).exportPdf(
        'user-1',
        'zh-CN',
        {
          selectedFields: ['profile', 'allergies'],
        },
      );

      expect(pdfService.buildPdf).toHaveBeenCalledWith(
        expect.objectContaining({ conditions: undefined }),
        'zh-CN',
      );
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
      // Legacy pre-persistence share: no store record, cache is the source.
      (
        prisma as unknown as {
          userClinicSummaryShare: { findFirst: vi.Mock };
        }
      ).userClinicSummaryShare = { findFirst: vi.fn().mockResolvedValue(null) };

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

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('张**');
    });

    it('returns 匿名用户 for null name', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue({
        ...mockUserRow,
        nickname: null,
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('匿名用户');
    });
  });

  // ── Field-drift lock (Task 3) ──────────────────────────────────────────
  // One request must yield the identical section set on every output path:
  // preview response, PDF builder input and the shared (cached) payload.
  // The share response builder (Task 4) will consume the same view model.

  describe('selected-field view model field drift', () => {
    const sectionKeys = (value: Record<string, unknown>): string[] =>
      [...CLINIC_SUMMARY_SECTION_KEYS]
        .filter((key) => value[key] !== undefined)
        .sort();

    it('preview, PDF input and shared payload expose identical section sets', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue({ publicBaseUrl: 'https://lumos.app' });
      const surface = service as unknown as SummaryServiceSurface;
      const options = {
        range: 'last_7_days',
        selectedFields: ['profile', 'conditions'],
      };

      const preview = await surface.buildClinicSummary(
        'user-1',
        'zh-CN',
        options,
      );
      await surface.exportPdf('user-1', 'zh-CN', options);
      await surface.createShareLink('user-1', 'zh-CN', options);

      const previewKeys = sectionKeys(
        preview as unknown as Record<string, unknown>,
      );
      const pdfInput = pdfService.buildPdf.mock
        .calls[0]![0] as unknown as Record<string, unknown>;
      const sharedPayload = cacheManager.set.mock
        .calls[0]![1] as unknown as Record<string, unknown>;

      expect(previewKeys).toEqual(['allergies', 'conditions', 'profile']);
      expect(sectionKeys(pdfInput)).toEqual(previewKeys);
      expect(sectionKeys(sharedPayload)).toEqual(previewKeys);
    });

    it('keeps every section when no selection is given', async () => {
      (prisma.user.findFirstOrThrow as vi.Mock).mockResolvedValue(mockUserRow);

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(sectionKeys(result as unknown as Record<string, unknown>)).toEqual(
        [...CLINIC_SUMMARY_SECTION_KEYS].sort(),
      );
    });
  });
});
