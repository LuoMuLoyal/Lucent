import type { ClinicSummaryDto } from '../../dto/clinic-summary-response.dto.js';
import { ClinicSummaryPdfService } from './pdf.service.js';

describe('ClinicSummaryPdfService', () => {
  let service: ClinicSummaryPdfService;

  beforeEach(() => {
    service = new ClinicSummaryPdfService();
  });

  const makeSummary = (
    overrides: Partial<ClinicSummaryDto> = {},
  ): ClinicSummaryDto => ({
    generatedAt: '2026-07-10T08:00:00.000Z',
    dataRange: 'last_30_days',
    scopeLabel: 'last_30_days',
    start: '2026-06-11T00:00:00.000Z',
    end: '2026-07-10T08:00:00.000Z',
    selectedFields: ['profile', 'allergies', 'conditions', 'currentMedicines'],
    coverage: {
      checkIns: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
      water: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
      dose: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
      sleep: {
        state: 'unknown',
        coverage: 'none',
        sources: [],
        observedCount: 0,
        expectedCount: null,
        windowStart: null,
        windowEnd: null,
      },
    },
    profile: {
      nickname: '张**',
      age: 25,
      sexAtBirth: 'male',
      bloodType: 'A',
    },
    allergies: [
      { label: '青霉素', reaction: '皮疹', severity: 'moderate' },
      { label: '海鲜', reaction: null, severity: null },
    ],
    conditions: [{ label: '高血压', status: 'active', diagnosedYear: 2023 }],
    currentMedicines: [{ displayName: '氨氯地平片', doseText: '5mg 每日一次' }],
    disclaimer: '此摘要仅供参考，不替代专业医疗诊断。',
    ...overrides,
  });

  describe('buildPdf', () => {
    it('generates a non-empty PDF buffer for zh-CN locale', async () => {
      const buffer = await service.buildPdf(makeSummary(), 'zh-CN');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // PDF magic bytes
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    }, 30_000);

    it('generates a non-empty PDF buffer for en locale', async () => {
      const buffer = await service.buildPdf(makeSummary(), 'en');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    }, 30_000);

    it('handles empty allergies', async () => {
      const buffer = await service.buildPdf(
        makeSummary({ allergies: [] }),
        'zh-CN',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('handles empty conditions', async () => {
      const buffer = await service.buildPdf(
        makeSummary({ conditions: [] }),
        'en',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('handles empty current medicines', async () => {
      const buffer = await service.buildPdf(
        makeSummary({ currentMedicines: [] }),
        'zh-CN',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('handles null optional fields in profile', async () => {
      const buffer = await service.buildPdf(
        makeSummary({
          profile: {
            nickname: '匿名用户',
            age: null,
            sexAtBirth: null,
            bloodType: null,
          },
        }),
        'en',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('handles null optional fields in allergies', async () => {
      const buffer = await service.buildPdf(
        makeSummary({
          allergies: [{ label: 'Test', reaction: null, severity: null }],
        }),
        'en',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('handles null diagnosedYear in conditions', async () => {
      const buffer = await service.buildPdf(
        makeSummary({
          conditions: [{ label: 'Test', status: null, diagnosedYear: null }],
        }),
        'en',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('handles null doseText in medicines', async () => {
      const buffer = await service.buildPdf(
        makeSummary({
          currentMedicines: [{ displayName: 'Test Med', doseText: null }],
        }),
        'zh-CN',
      );

      expect(buffer.length).toBeGreaterThan(0);
    }, 30_000);

    it('produces different output for different locales', async () => {
      const zhBuffer = await service.buildPdf(makeSummary(), 'zh-CN');
      const enBuffer = await service.buildPdf(makeSummary(), 'en');

      // The PDFs should be different since the titles and labels differ
      expect(zhBuffer.equals(enBuffer)).toBe(false);
    }, 30_000);

    // ── Workstream 2 red lock (fix owned by VS3) ──────────────────────────

    it('renders findings into the PDF when the summary contains them', async () => {
      const withFindings = makeSummary({
        findings: ['hydration_low', 'dose_stable'],
      });
      const withoutFindings = makeSummary();

      const bufferWith = await service.buildPdf(withFindings, 'en');
      const bufferWithout = await service.buildPdf(withoutFindings, 'en');

      expect(bufferWith.equals(bufferWithout)).toBe(false);
    }, 30_000);

    it('renders the fixed insufficient_coverage statement localized per locale', async () => {
      // The 资料不足 statement is localized on the PDF (zh 资料不足 / en
      // Insufficient data); other finding codes stay raw.
      const bufferZh = await service.buildPdf(
        makeSummary({ findings: ['insufficient_coverage'] }),
        'zh-CN',
      );
      const bufferEn = await service.buildPdf(
        makeSummary({ findings: ['insufficient_coverage'] }),
        'en',
      );

      expect(bufferZh.length).toBeGreaterThan(0);
      expect(bufferZh.equals(bufferEn)).toBe(false);
    }, 30_000);
  });
});
