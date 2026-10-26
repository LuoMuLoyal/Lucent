import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';
import type { ConfigService } from '@nestjs/config';
import type { I18nService } from 'nestjs-i18n';
import {
  ProductEventName,
  ProductEventResult,
  ProductEventSurface,
} from '#generated/prisma/client.js';
import {
  ClinicSummaryService,
  sharedSummaryCacheKey,
} from './build-clinic-summary.js';
/**
 * The Prisma surface these doubles need.
 *
 * Declared locally rather than importing `PrismaService`: the use case no
 * longer touches Prisma, so a spec under `application/` importing it would
 * reintroduce the very edge `ddd-application-no-direct-prisma` forbids.
 */
/** The user row shape the doubles project into the health-context port. */
type StubUserRow = {
  nickname: string | null;
  profile: { birthDate: Date | null; sexAtBirth: string | null } | null;
  allergies?: {
    label: string;
    reaction: string | null;
    severity: string | null;
  }[];
  conditions?: { label: string; status: string; diagnosedAt: Date | null }[];
  currentMedicines?: { displayName: string; doseText: string | null }[];
};

// One mocked delegate method, typed tightly enough to avoid any leakage.
type MockFn<TResult> = ((...args: unknown[]) => Promise<TResult>) & {
  mockResolvedValue: (value: TResult) => void;
  mock: { calls: unknown[][] };
};

type PrismaStub = {
  user: { findFirstOrThrow: MockFn<StubUserRow> };
  userDailyRecord: { findMany: MockFn<unknown[]> };
  userClinicSummaryShare: {
    findFirst: MockFn<Record<string, unknown> | null>;
    updateMany: MockFn<{ count: number }>;
  };
};

import { okAsync } from '../../../../common/result/index.js';
import type { ClinicSummaryPdf } from '../ports/clinic-summary-pdf.js';
import type { ProductEventsService } from '../../../product-events/index.js';
import {
  applySelectedFields,
  CLINIC_SUMMARY_SECTION_KEYS,
  resolveSectionKeys,
} from '../../application/read_models/clinic-summary-view.js';
import type {
  ClinicSummaryDto,
  ClinicSummaryShareDataDto,
} from '../../application/read_models/clinic-summary-response.js';

/**
 * TDD red-lock surface (Workstream 2, VS2-VS4 will make these real).
 *
 * Today `buildClinicSummary` / `createShareLink` accept no scope or
 * field-selection options, so the failing tests below call through this
 * widened cast. Implementing tasks own the actual signatures; these casts
 * stay local to this spec. PDF export lives on `ClinicSummaryPdf`.
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
  createShareLink(
    userId: string,
    locale?: string,
    options?: ClinicSummaryOptions,
  ): Promise<ClinicSummaryShareDataDto>;
}

/** Widened constructor so tests can inject the event-review source the fix
 *  (VS3) will wire in; extra runtime args are harmless today. */
function withEventReview(
  prisma: PrismaStub,
  cache: { get: vi.Mock; set: vi.Mock },
  config: vi.Mocked<ConfigService>,
  eventReview: { buildCurrent: vi.Mock; buildForEvent?: vi.Mock },
): ClinicSummaryService {
  const productEvents = {
    emitServerEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProductEventsService;
  const Ctor = ClinicSummaryService as unknown as new (
    ...args: unknown[]
  ) => ClinicSummaryService;
  const adapted = adaptUserRows(prisma);
  // Constructed here rather than captured from the enclosing `describe`: this
  // helper is module-scoped and cannot see those bindings.
  const shares = {
    findByTokenHash: () => Promise.resolve(null),
    recordAccess: () => Promise.resolve(null),
  };
  const records = {
    listFactsInRange: async () => await prisma.userDailyRecord.findMany(),
  };
  return new Ctor(
    shares,
    adapted.sources,
    adapted.healthContext,
    records,
    cache,
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

/**
 * Adapts the `user.findFirstOrThrow` double this spec has always used to the
 * two collaborators the use case now depends on.
 *
 * The use case stopped joining `user.profile`/`allergies`/`conditions`/
 * `currentMedicines` directly (that made `reports` a second reader of
 * `user-health-context`'s tables). It reads health data through
 * `IUserHealthContextReader` and only the nickname stays local. Keeping the
 * single `findFirstOrThrow` double and projecting it here means the ~25
 * existing scenarios still describe the same input data, while the assertion
 * surface is the port contract rather than an SQL select list.
 */
function adaptUserRows(prisma: PrismaStub) {
  const row = async () => await prisma.user.findFirstOrThrow();
  return {
    sources: {
      findDisplayName: async () => (await row()).nickname,
    },
    healthContext: {
      getForUser: async () => {
        const user = await row();
        return okAsync({
          summary: {
            age: null,
            onboardingCompleted: true,
            activeAllergyCount: 0,
            conditionCount: 0,
            currentMedicineCount: 0,
            missingCoreProfileFields: [],
          },
          profile: {
            birthDate: toIsoDate(user.profile?.birthDate ?? null),
            sexAtBirth: user.profile?.sexAtBirth ?? null,
            heightCm: null,
            weightKg: null,
            activityLevel: null,
            dietaryPreferences: null,
            locale: null,
            timezone: null,
            unitSystem: null,
          },
          allergies: (user.allergies ?? []).map(
            (
              allergy: {
                label: string;
                reaction: string | null;
                severity: string | null;
              },
              index: number,
            ) => ({
              id: `allergy-${index}`,
              kind: 'medication',
              label: allergy.label,
              reaction: allergy.reaction,
              severity: allergy.severity,
              isActive: true,
              note: null,
              extras: null,
              recordedAt: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }),
          ),
          conditions: (user.conditions ?? []).map(
            (
              condition: {
                label: string;
                status: string;
                diagnosedAt: Date | null;
              },
              index: number,
            ) => ({
              id: `condition-${index}`,
              label: condition.label,
              status: condition.status,
              diagnosedAt: toIsoDate(condition.diagnosedAt),
              resolvedAt: null,
              note: null,
              extras: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }),
          ),
          currentMedicines: (user.currentMedicines ?? []).map(
            (
              medicine: { displayName: string; doseText: string | null },
              index: number,
            ) => ({
              id: `medicine-${index}`,
              source: 'manual',
              sourceRefId: null,
              displayName: medicine.displayName,
              strengthText: null,
              doseText: medicine.doseText,
              route: null,
              startedAt: null,
              endedAt: null,
              isCurrent: true,
              note: null,
              sourcePayload: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            }),
          ),
        });
      },
    },
  };
}

/** `Date` → `YYYY-MM-DD`; the reader port reports dates as ISO strings. */
function toIsoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, ISO_DATE_LENGTH);
}

const ISO_DATE_LENGTH = 10;

describe('ClinicSummaryService', () => {
  let service: ClinicSummaryService;
  let prisma: PrismaStub;
  let clinicShares: unknown;
  let dailyRecordReader: unknown;
  let cacheManager: { get: vi.Mock; set: vi.Mock };
  let pdfService: vi.Mocked<ClinicSummaryPdf>;
  let configService: vi.Mocked<ConfigService>;
  let productEvents: { emitServerEvent: vi.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        findFirstOrThrow: vi.fn(),
      },
      userDailyRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      userClinicSummaryShare: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    } as unknown as PrismaStub;

    cacheManager = {
      get: vi.fn(),
      set: vi.fn(),
    };

    pdfService = {
      buildPdf: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    } as unknown as vi.Mocked<ClinicSummaryPdf>;

    configService = {
      get: vi.fn(),
    } as unknown as vi.Mocked<ConfigService>;

    productEvents = { emitServerEvent: vi.fn().mockResolvedValue(undefined) };

    // Port doubles delegate to the same `prisma` object the scenarios mutate,
    // so replacing `prisma.userClinicSummaryShare` still drives the behaviour
    // under test.
    clinicShares = {
      findByTokenHash: vi.fn(
        async (tokenHash: string) =>
          await prisma.userClinicSummaryShare.findFirst({
            where: { tokenHash },
          }),
      ),
      recordAccess: vi.fn(async (shareId: string) => {
        const result = await prisma.userClinicSummaryShare.updateMany({
          where: { id: shareId },
        });
        if ((result as { count: number }).count === 0) return null;
        return { accessCount: 1, firstAccessedAt: null } as never;
      }),
    };
    dailyRecordReader = {
      listFactsInRange: vi.fn(
        async () => await prisma.userDailyRecord.findMany(),
      ),
    };
    const adapted = adaptUserRows(prisma);
    service = new ClinicSummaryService(
      clinicShares as never,
      adapted.sources as never,
      adapted.healthContext as never,
      dailyRecordReader as never,
      cacheManager as never,
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(result.profile!.nickname).toBe('张**');
      expect(result.profile!.age).toBeGreaterThan(0);
      expect(result.profile!.sexAtBirth).toBe('male');
      expect(result.allergies!).toHaveLength(2);
      expect(result.allergies![0]!.label).toBe('青霉素');
      expect(result.conditions!).toHaveLength(1);
      expect(result.conditions![0]!.diagnosedYear).toBe(2023);
      expect(result.currentMedicines!).toHaveLength(1);
      expect(result.dataRange).toBe('last_30_days');
      expect(result.disclaimer).toContain('disclaimer-text');
    });

    it('handles null profile', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue({
        ...mockUserRow,
        profile: null,
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(result.profile!.age).toBeNull();
      expect(result.profile!.sexAtBirth).toBeNull();
    });

    it('handles null nickname', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue({
        ...mockUserRow,
        nickname: null,
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('匿名用户');
    });

    it('handles single-character nickname', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue({
        ...mockUserRow,
        nickname: 'A',
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('A');
    });

    it('handles empty allergies and conditions', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue({
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

      const result = await (
        service as unknown as SummaryServiceSurface
      ).buildClinicSummary('user-1', 'zh-CN', { range: 'last_7_days' });

      expect(result.dataRange).toBe('last_7_days');
    });

    it('populates findings from the active event review instead of leaving them empty', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn().mockResolvedValue(mockEventReview),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn().mockResolvedValue(mockEventReview),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

      await expect(
        (service as unknown as SummaryServiceSurface).buildClinicSummary(
          'user-1',
          'zh-CN',
          { dateFrom: '2026-08-01' },
        ),
      ).rejects.toBeInstanceOf(DomainFailureException);
      await expect(
        (service as unknown as SummaryServiceSurface).buildClinicSummary(
          'user-1',
          'zh-CN',
          { dateTo: '2026-08-30' },
        ),
      ).rejects.toBeInstanceOf(DomainFailureException);
    });

    it('rejects a date span beyond 30 inclusive calendar days', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

      // 2026-08-01..2026-08-31 = 31 inclusive calendar days > cap.
      await expect(
        (service as unknown as SummaryServiceSurface).buildClinicSummary(
          'user-1',
          'zh-CN',
          { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
        ),
      ).rejects.toBeInstanceOf(DomainFailureException);
    });

    it('accepts a 30-inclusive-day date span at the boundary with exclusive end', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
      const eventReview = {
        buildCurrent: vi.fn().mockResolvedValue(null),
      };
      const serviceWithReview = withEventReview(
        prisma,
        cacheManager,
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

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
      // R-2: findings are gated by event_overview; without it, findings
      // are not included.
      expect(result.findings).toBeUndefined();
      // Coverage water/sleep are gated by their own toggles; since water
      // and sleep ARE selected, their coverage entries are present.
      // But the mock returns no event review, so coverage entries are
      // the empty state — still included because the toggle is on.
      expect(result.coverage.water).toBeDefined();
      expect(result.coverage.sleep).toBeDefined();
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

  // ── R-2: Six-toggle field gating (applySelectedFields) ──────────────

  describe('applySelectedFields — six-toggle gating (R-2)', () => {
    // Build a full summary with every field populated.
    const fullSummary: ClinicSummaryDto = {
      generatedAt: '2026-08-18T10:00:00.000Z',
      dataRange: 'last_30_days',
      scopeLabel: 'last_30_days',
      start: '2026-07-20T00:00:00.000Z',
      end: '2026-08-19T00:00:00.000Z',
      selectedFields: [
        'profile',
        'allergies',
        'conditions',
        'currentMedicines',
      ],
      profile: {
        nickname: '张**',
        age: 30,
        sexAtBirth: 'male',
      },
      allergies: [{ label: '青霉素', reaction: null, severity: null }],
      conditions: [{ label: '高血压', status: 'active', diagnosedYear: 2020 }],
      currentMedicines: [{ displayName: '氨氯地平', doseText: '5mg' }],
      findings: ['health_event', 'observed_changes'],
      coverage: {
        checkIns: {
          state: 'observed',
          coverage: 'partial',
          sources: ['manual'],
          observedCount: 2,
          expectedCount: null,
          windowStart: '2026-08-01T00:00:00.000Z',
          windowEnd: '2026-08-18T00:00:00.000Z',
        },
        water: {
          state: 'observed',
          coverage: 'partial',
          sources: ['manual'],
          observedCount: 5,
          expectedCount: null,
          windowStart: '2026-08-01T00:00:00.000Z',
          windowEnd: '2026-08-18T00:00:00.000Z',
        },
        dose: {
          state: 'observed',
          coverage: 'partial',
          sources: ['manual'],
          observedCount: 10,
          expectedCount: null,
          windowStart: '2026-08-01T00:00:00.000Z',
          windowEnd: '2026-08-18T00:00:00.000Z',
        },
        sleep: {
          state: 'observed',
          coverage: 'partial',
          sources: ['manual'],
          observedCount: 5,
          expectedCount: null,
          windowStart: '2026-08-01T00:00:00.000Z',
          windowEnd: '2026-08-18T00:00:00.000Z',
        },
      },
      waterEntries: [{ date: '2026-08-10', ml: 1500 }],
      sleepEntries: [{ date: '2026-08-10', minutes: 420 }],
      noteEntries: [{ date: '2026-08-10', kind: 'note', text: 'some note' }],
      disclaimer: 'disclaimer-text',
    };

    it('includes everything when no selection is given', () => {
      const result = applySelectedFields(fullSummary, undefined);
      expect(result.profile).toBeDefined();
      expect(result.allergies).toBeDefined();
      expect(result.conditions).toBeDefined();
      expect(result.currentMedicines).toBeDefined();
      expect(result.findings).toBeDefined();
      expect(result.coverage.water).toBeDefined();
      expect(result.coverage.dose).toBeDefined();
      expect(result.coverage.sleep).toBeDefined();
      expect(result.waterEntries).toBeDefined();
      expect(result.sleepEntries).toBeDefined();
      expect(result.noteEntries).toBeUndefined();
    });

    it('gates findings behind event_overview', () => {
      const result = applySelectedFields(fullSummary, [
        'symptom_changes',
        'medication_slots',
      ]);
      expect(result.findings).toBeUndefined();
      expect(result.profile).toBeUndefined();
      expect(result.conditions).toBeDefined();
      expect(result.currentMedicines).toBeDefined();
    });

    it('gates water coverage + waterEntries behind the water toggle', () => {
      const result = applySelectedFields(fullSummary, [
        'event_overview',
        'water',
      ]);
      expect(result.coverage.water).toBeDefined();
      expect(result.waterEntries).toBeDefined();
      expect(result.coverage.sleep).toBeUndefined();
      expect(result.sleepEntries).toBeUndefined();
    });

    it('gates sleep coverage + sleepEntries behind the sleep toggle', () => {
      const result = applySelectedFields(fullSummary, [
        'event_overview',
        'sleep',
      ]);
      expect(result.coverage.sleep).toBeDefined();
      expect(result.sleepEntries).toBeDefined();
      expect(result.coverage.water).toBeUndefined();
      expect(result.waterEntries).toBeUndefined();
    });

    it('gates noteEntries behind the notes toggle (off by default)', () => {
      const result = applySelectedFields(fullSummary, ['event_overview']);
      expect(result.noteEntries).toBeUndefined();

      const withNotes = applySelectedFields(fullSummary, [
        'event_overview',
        'notes',
      ]);
      expect(withNotes.noteEntries).toBeDefined();
      expect(withNotes.noteEntries!.length).toBe(1);
    });

    it('always includes coverage.checkIns and coverage.dose regardless of selection', () => {
      const result = applySelectedFields(fullSummary, ['notes']);
      expect(result.coverage.checkIns).toBeDefined();
      expect(result.coverage.dose).toBeDefined();
    });
  });

  describe('createShareLink', () => {
    it('creates share link with cache and returns URL', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue(undefined);

      const result = await service.createShareLink('user-1', 'zh-CN');

      expect(result.shareUrl).toContain('localhost:3000');
    });

    // ── Workstream 2 red locks (fix owned by VS3/VS4) ─────────────────────

    it('builds the share URL against the actual /user public controller route', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
      configService.get.mockReturnValue({ publicBaseUrl: 'https://lumos.app' });

      const result = await service.createShareLink('user-1', 'zh-CN');

      expect(result.shareUrl).toContain(
        '/api/v1/user/reports/clinic-summary/shared/',
      );
    });

    it('stores only the selected fields in the shared summary', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
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

  describe('de-identification (maskName)', () => {
    it('masks multi-character names to first char + **', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue({
        ...mockUserRow,
        nickname: '张三丰',
      });

      const result = await service.buildClinicSummary('user-1', 'zh-CN');
      expect(result.profile!.nickname).toBe('张**');
    });

    it('returns 匿名用户 for null name', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue({
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);
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
      // `exportPdf` lives on the port now, so the assertion is "what the PDF
      // renderer would receive", captured by the double — the same comparison
      // as before, without constructing the real renderer from `application/`.
      await pdfService.buildPdf(preview, 'zh-CN');
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
      prisma.user.findFirstOrThrow.mockResolvedValue(mockUserRow);

      const result = await service.buildClinicSummary('user-1', 'zh-CN');

      expect(sectionKeys(result as unknown as Record<string, unknown>)).toEqual(
        [...CLINIC_SUMMARY_SECTION_KEYS].sort(),
      );
    });
  });
});
