import {
  buildReadEnvelope,
  buildDailyRecordCoverage,
  buildDailyRecordRangeCoverage,
  buildReadConfidence,
  buildProposalExpiryIso,
  buildCreateRecordPreviewFields,
  buildUpdateRecordPreviewFields,
  buildSettingsPreviewFields,
  collectSettingsDraftKeys,
  localeText,
  boolText,
  contextPreviewLabel,
  describeCreateRecordSummary,
  describeUpdateRecordSummary,
  describeDeleteRecordSummary,
  describeRecordTargetLabel,
} from './presenters.js';
import { DailyRecordKind } from '#generated/prisma/client.js';

describe('presenters', () => {
  // -----------------------------------------------------------------------
  // buildReadEnvelope
  // -----------------------------------------------------------------------
  describe('buildReadEnvelope', () => {
    it('builds a complete envelope with all fields', () => {
      const envelope = buildReadEnvelope({
        toolName: 'get_today_records',
        query: { date: '2026-07-11' },
        result: { items: [] },
        coverage: { status: 'complete', reason: null },
        timeRange: { timezone: 'UTC', startDate: '2026-07-11', endDate: null },
        confidence: { level: 'high', reason: 'all good' },
        ambiguities: [],
        tables: ['daily_records'],
      });

      expect(envelope.query).toEqual({ date: '2026-07-11' });
      expect(envelope.result).toEqual({ items: [] });
      expect(envelope.coverage.status).toBe('complete');
      expect(envelope.source.tool).toBe('get_today_records');
      expect(envelope.source.tables).toEqual(['daily_records']);
      expect(envelope.source.generatedAt).toBeTruthy();
      expect(envelope.confidence.level).toBe('high');
      expect(envelope.ambiguities).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // buildDailyRecordCoverage
  // -----------------------------------------------------------------------
  describe('buildDailyRecordCoverage', () => {
    it('returns complete when data exists and sleep is included', () => {
      const coverage = buildDailyRecordCoverage({
        hasData: true,
        sleepIncluded: true,
      });
      expect(coverage.status).toBe('complete');
      expect(coverage.reason).toBeNull();
    });

    it('returns empty when no data and sleep is included', () => {
      const coverage = buildDailyRecordCoverage({
        hasData: false,
        sleepIncluded: true,
      });
      expect(coverage.status).toBe('empty');
      expect(coverage.reason).toContain('No daily records');
    });

    it('returns partial when sleep is excluded', () => {
      const coverage = buildDailyRecordCoverage({
        hasData: true,
        sleepIncluded: false,
      });
      expect(coverage.status).toBe('partial');
      expect(coverage.reason).toContain('Sleep records are excluded');
      expect(coverage.omittedContextSources).toEqual(['sleep_records']);
      expect(coverage.omittedKinds).toEqual(['sleep']);
    });

    it('returns partial (sleep excluded) even when no data', () => {
      const coverage = buildDailyRecordCoverage({
        hasData: false,
        sleepIncluded: false,
      });
      expect(coverage.status).toBe('partial');
      expect(coverage.omittedKinds).toEqual(['sleep']);
    });
  });

  // -----------------------------------------------------------------------
  // buildDailyRecordRangeCoverage
  // -----------------------------------------------------------------------
  describe('buildDailyRecordRangeCoverage', () => {
    it('returns complete when data exists, not truncated, sleep included', () => {
      const coverage = buildDailyRecordRangeCoverage({
        total: 5,
        truncated: false,
        sleepIncluded: true,
      });
      expect(coverage.status).toBe('complete');
    });

    it('returns empty when total is 0 and no issues', () => {
      const coverage = buildDailyRecordRangeCoverage({
        total: 0,
        truncated: false,
        sleepIncluded: true,
      });
      expect(coverage.status).toBe('empty');
      expect(coverage.reason).toContain('No daily records');
    });

    it('returns partial when truncated', () => {
      const coverage = buildDailyRecordRangeCoverage({
        total: 10,
        truncated: true,
        sleepIncluded: true,
      });
      expect(coverage.status).toBe('partial');
      expect(coverage.reason).toContain('truncated');
    });

    it('returns partial when sleep is excluded', () => {
      const coverage = buildDailyRecordRangeCoverage({
        total: 5,
        truncated: false,
        sleepIncluded: false,
      });
      expect(coverage.status).toBe('partial');
      expect(coverage.omittedContextSources).toEqual(['sleep_records']);
      expect(coverage.omittedKinds).toEqual([DailyRecordKind.sleep]);
    });

    it('combines reasons when both truncated and sleep excluded', () => {
      const coverage = buildDailyRecordRangeCoverage({
        total: 5,
        truncated: true,
        sleepIncluded: false,
      });
      expect(coverage.status).toBe('partial');
      expect(coverage.reason).toContain('truncated');
      expect(coverage.reason).toContain('Sleep records');
    });
  });

  // -----------------------------------------------------------------------
  // buildReadConfidence
  // -----------------------------------------------------------------------
  describe('buildReadConfidence', () => {
    it('returns high when no ambiguities and not truncated', () => {
      const conf = buildReadConfidence({
        ambiguities: [],
        truncated: false,
        preferredReason: 'exact match',
      });
      expect(conf.level).toBe('high');
      expect(conf.reason).toBe('exact match');
    });

    it('returns medium when 1-2 ambiguities', () => {
      const conf = buildReadConfidence({
        ambiguities: ['amb1'],
        truncated: false,
        preferredReason: 'some reason',
      });
      expect(conf.level).toBe('medium');
    });

    it('returns medium when 2 ambiguities', () => {
      const conf = buildReadConfidence({
        ambiguities: ['amb1', 'amb2'],
        truncated: false,
        preferredReason: 'some reason',
      });
      expect(conf.level).toBe('medium');
    });

    it('returns low when more than 2 ambiguities', () => {
      const conf = buildReadConfidence({
        ambiguities: ['amb1', 'amb2', 'amb3'],
        truncated: false,
        preferredReason: 'some reason',
      });
      expect(conf.level).toBe('low');
    });

    it('returns medium when truncated with no ambiguities', () => {
      const conf = buildReadConfidence({
        ambiguities: [],
        truncated: true,
        preferredReason: 'some reason',
      });
      expect(conf.level).toBe('medium');
    });

    it('returns low when truncated and more than 2 ambiguities', () => {
      const conf = buildReadConfidence({
        ambiguities: ['amb1', 'amb2', 'amb3'],
        truncated: true,
        preferredReason: 'some reason',
      });
      expect(conf.level).toBe('low');
    });

    it('returns medium when truncated with 1 ambiguity', () => {
      const conf = buildReadConfidence({
        ambiguities: ['amb1'],
        truncated: true,
        preferredReason: 'some reason',
      });
      expect(conf.level).toBe('medium');
    });
  });

  // -----------------------------------------------------------------------
  // buildProposalExpiryIso
  // -----------------------------------------------------------------------
  describe('buildProposalExpiryIso', () => {
    it('returns an ISO string in the future by the given TTL', () => {
      const ttlMinutes = 15;
      const before = Date.now();
      const expiry = buildProposalExpiryIso(ttlMinutes);
      const after = Date.now();

      const expiryMs = new Date(expiry).getTime();
      expect(expiryMs).toBeGreaterThanOrEqual(
        before + ttlMinutes * 60 * 1000 - 1000,
      );
      expect(expiryMs).toBeLessThanOrEqual(
        after + ttlMinutes * 60 * 1000 + 1000,
      );
    });

    it('returns a valid ISO date string', () => {
      const expiry = buildProposalExpiryIso(5);
      expect(new Date(expiry).toISOString()).toBe(expiry);
    });

    it('returns current time when TTL is 0', () => {
      const before = Date.now();
      const expiry = buildProposalExpiryIso(0);
      const after = Date.now();
      const expiryMs = new Date(expiry).getTime();
      expect(expiryMs).toBeGreaterThanOrEqual(before - 1000);
      expect(expiryMs).toBeLessThanOrEqual(after + 1000);
    });
  });

  // -----------------------------------------------------------------------
  // buildCreateRecordPreviewFields
  // -----------------------------------------------------------------------
  describe('buildCreateRecordPreviewFields', () => {
    it('builds fields with value and unit in zh-CN', () => {
      const fields = buildCreateRecordPreviewFields(
        {
          kind: DailyRecordKind.water,
          occurredAt: '2026-07-11',
          title: '喝水',
          value: '500',
          unit: 'ml',
          note: '早餐后',
        },
        'zh-CN',
      );
      expect(fields).toContainEqual({
        label: '类型',
        value: 'water',
      });
      expect(fields).toContainEqual({
        label: '日期',
        value: '2026-07-11',
      });
      expect(fields).toContainEqual({
        label: '数值',
        value: '500 ml',
      });
      expect(fields).toContainEqual({
        label: '标题',
        value: '喝水',
      });
      expect(fields).toContainEqual({
        label: '备注',
        value: '早餐后',
      });
    });

    it('omits value field when null', () => {
      const fields = buildCreateRecordPreviewFields(
        {
          kind: DailyRecordKind.note,
          occurredAt: '2026-07-11',
          title: null,
          value: null,
          unit: null,
          note: null,
        },
        'en',
      );
      expect(fields).toHaveLength(2);
      expect(fields[0]!.label).toBe('Kind');
      expect(fields[1]!.label).toBe('Date');
    });

    it('shows value without unit when unit is null', () => {
      const fields = buildCreateRecordPreviewFields(
        {
          kind: DailyRecordKind.symptom,
          occurredAt: '2026-07-11',
          title: null,
          value: '3/5',
          unit: null,
          note: null,
        },
        'en',
      );
      expect(fields).toContainEqual({ label: 'Value', value: '3/5' });
    });
  });

  // -----------------------------------------------------------------------
  // buildUpdateRecordPreviewFields
  // -----------------------------------------------------------------------
  describe('buildUpdateRecordPreviewFields', () => {
    it('includes only provided fields', () => {
      const fields = buildUpdateRecordPreviewFields(
        { title: '新标题', value: null, unit: null, note: null },
        'zh-CN',
      );
      expect(fields).toHaveLength(1);
      expect(fields[0]).toEqual({ label: '标题', value: '新标题' });
    });

    it('includes value with unit', () => {
      const fields = buildUpdateRecordPreviewFields(
        { title: null, value: '500', unit: 'ml', note: null },
        'en',
      );
      expect(fields).toContainEqual({ label: 'Value', value: '500 ml' });
    });

    it('includes note when provided', () => {
      const fields = buildUpdateRecordPreviewFields(
        { title: null, value: null, unit: null, note: 'updated note' },
        'en',
      );
      expect(fields).toEqual([{ label: 'Note', value: 'updated note' }]);
    });

    it('returns empty array when no fields provided', () => {
      const fields = buildUpdateRecordPreviewFields(
        { title: null, value: null, unit: null, note: null },
        'zh-CN',
      );
      expect(fields).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // buildSettingsPreviewFields
  // -----------------------------------------------------------------------
  describe('buildSettingsPreviewFields', () => {
    it('includes assistantEnabled field', () => {
      const fields = buildSettingsPreviewFields(
        { assistantEnabled: true },
        'zh-CN',
      );
      expect(fields).toContainEqual({ label: '助手', value: '开启' });
    });

    it('includes assistantMemoryEnabled field', () => {
      const fields = buildSettingsPreviewFields(
        { assistantMemoryEnabled: false },
        'en',
      );
      expect(fields).toContainEqual({
        label: 'Persistent memory',
        value: 'Off',
      });
    });

    it('includes assistantContext fields', () => {
      const fields = buildSettingsPreviewFields(
        {
          assistantContext: {
            healthProfile: true,
            dailyRecords: false,
          },
        },
        'zh-CN',
      );
      expect(fields).toContainEqual({ label: '健康档案', value: '开启' });
      expect(fields).toContainEqual({ label: '最近记录', value: '关闭' });
    });

    it('returns empty for empty draft', () => {
      const fields = buildSettingsPreviewFields({}, 'en');
      expect(fields).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // collectSettingsDraftKeys
  // -----------------------------------------------------------------------
  describe('collectSettingsDraftKeys', () => {
    it('collects top-level keys', () => {
      const keys = collectSettingsDraftKeys({
        assistantEnabled: true,
        assistantMemoryEnabled: false,
      });
      expect(keys).toContain('assistantEnabled');
      expect(keys).toContain('assistantMemoryEnabled');
    });

    it('collects nested context keys with dot notation', () => {
      const keys = collectSettingsDraftKeys({
        assistantContext: {
          healthProfile: true,
          sleepRecords: false,
        },
      });
      expect(keys).toContain('assistantContext.healthProfile');
      expect(keys).toContain('assistantContext.sleepRecords');
    });

    it('returns empty for empty draft', () => {
      expect(collectSettingsDraftKeys({})).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // locale helpers
  // -----------------------------------------------------------------------
  describe('localeText', () => {
    it('returns Chinese text for zh-CN', () => {
      expect(localeText('zh-CN', '中文', 'English')).toBe('中文');
    });

    it('returns English text for en', () => {
      expect(localeText('en', '中文', 'English')).toBe('English');
    });
  });

  describe('boolText', () => {
    it('returns 开启/关闭 for zh-CN', () => {
      expect(boolText(true, 'zh-CN')).toBe('开启');
      expect(boolText(false, 'zh-CN')).toBe('关闭');
    });

    it('returns On/Off for en', () => {
      expect(boolText(true, 'en')).toBe('On');
      expect(boolText(false, 'en')).toBe('Off');
    });
  });

  describe('contextPreviewLabel', () => {
    it('maps known keys to localized labels', () => {
      expect(contextPreviewLabel('healthProfile', 'zh-CN')).toBe('健康档案');
      expect(contextPreviewLabel('healthProfile', 'en')).toBe('Health profile');
      expect(contextPreviewLabel('dailyRecords', 'zh-CN')).toBe('最近记录');
      expect(contextPreviewLabel('dailyRecords', 'en')).toBe('Recent records');
      expect(contextPreviewLabel('sleepRecords', 'zh-CN')).toBe('睡眠数据');
      expect(contextPreviewLabel('sleepRecords', 'en')).toBe('Sleep data');
      expect(contextPreviewLabel('currentMedicines', 'zh-CN')).toBe('当前用药');
      expect(contextPreviewLabel('currentMedicines', 'en')).toBe(
        'Current medicines',
      );
    });

    it('returns the raw key for unknown keys', () => {
      expect(contextPreviewLabel('unknown', 'zh-CN')).toBe('unknown');
      expect(contextPreviewLabel('unknown', 'en')).toBe('unknown');
    });
  });

  // -----------------------------------------------------------------------
  // Summary descriptions
  // -----------------------------------------------------------------------
  describe('describeCreateRecordSummary', () => {
    it('includes value in zh-CN summary', () => {
      const summary = describeCreateRecordSummary(
        {
          kind: DailyRecordKind.water,
          occurredAt: '2026-07-11',
          value: '500',
          unit: 'ml',
        },
        'zh-CN',
      );
      expect(summary).toContain('water');
      expect(summary).toContain('2026-07-11');
    });

    it('omits value in zh-CN summary when null', () => {
      const summary = describeCreateRecordSummary(
        {
          kind: DailyRecordKind.note,
          occurredAt: '2026-07-11',
          value: null,
          unit: null,
        },
        'zh-CN',
      );
      expect(summary).not.toContain('500');
      expect(summary).toContain('2026-07-11');
    });

    it('builds English summary', () => {
      const summary = describeCreateRecordSummary(
        {
          kind: DailyRecordKind.water,
          occurredAt: '2026-07-11',
          value: '500',
          unit: 'ml',
        },
        'en',
      );
      expect(summary).toContain('water');
      expect(summary).toContain('2026-07-11');
    });
  });

  describe('describeUpdateRecordSummary', () => {
    it('builds zh-CN summary', () => {
      const summary = describeUpdateRecordSummary(
        { kind: DailyRecordKind.water, occurredAt: '2026-07-11' },
        'zh-CN',
      );
      expect(summary).toContain('water');
      expect(summary).toContain('2026-07-11');
    });

    it('builds English summary', () => {
      const summary = describeUpdateRecordSummary(
        { kind: DailyRecordKind.symptom, occurredAt: '2026-07-11' },
        'en',
      );
      expect(summary).toContain('symptom');
      expect(summary).toContain('2026-07-11');
    });
  });

  describe('describeDeleteRecordSummary', () => {
    it('builds zh-CN summary', () => {
      const summary = describeDeleteRecordSummary(
        { kind: DailyRecordKind.note, occurredAt: '2026-07-11' },
        'zh-CN',
      );
      expect(summary).toContain('删除');
      expect(summary).toContain('note');
    });

    it('builds English summary', () => {
      const summary = describeDeleteRecordSummary(
        { kind: DailyRecordKind.note, occurredAt: '2026-07-11' },
        'en',
      );
      expect(summary).toContain('delete');
      expect(summary).toContain('note');
    });
  });

  describe('describeRecordTargetLabel', () => {
    it('builds label with value and unit', () => {
      const label = describeRecordTargetLabel(
        {
          kind: DailyRecordKind.water,
          occurredAt: '2026-07-11',
          value: '500',
          unit: 'ml',
        },
        'zh-CN',
      );
      expect(label).toBe('2026-07-11 water 500 ml');
    });

    it('builds label without value when null', () => {
      const label = describeRecordTargetLabel(
        {
          kind: DailyRecordKind.note,
          occurredAt: '2026-07-11',
          value: null,
          unit: null,
        },
        'en',
      );
      expect(label).toBe('2026-07-11 note');
    });
  });
});
