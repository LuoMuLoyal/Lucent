import { DeterioratingTrendRuleService } from './deteriorating-trend.service.js';
import { SuggestionType } from '../../../types/suggestion.types.js';
import { buildContext, buildSignal } from '../test-helpers.js';

/** 一条症状趋势条目（payload 码来自客户端 `payload.symptom` / `payload.severity`）。 */
function entry(
  date: string,
  severity: string | null,
  {
    symptom = 'headache',
    title = '头痛',
    value = '轻度',
  }: { symptom?: string | null; title?: string; value?: string | null } = {},
) {
  return { date, symptom, severity, title, value };
}

function signal(byDate: Array<Record<string, unknown>>) {
  return buildSignal({
    source: 'record',
    kind: 'symptom_trend',
    payload: {
      byDate,
      totalRecords: byDate.length,
      uniqueDates: byDate.length,
    },
  });
}

describe('DeterioratingTrendRuleService', () => {
  let rule: DeterioratingTrendRuleService;

  beforeEach(() => {
    rule = new DeterioratingTrendRuleService();
  });

  it('should match when severity codes worsen over consecutive days', () => {
    const signals = [
      signal([
        entry('2026-07-07', 'mild'),
        entry('2026-07-08', 'moderate'),
        entry('2026-07-09', 'severe'),
      ]),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.type).toBe(SuggestionType.TREND);
    expect(candidate!.copyGeneration.templateKey).toBe(
      'symptom.deteriorating.trend',
    );
    expect(candidate!.copyGeneration.params['symptomTitle']).toBe('头痛');
  });

  it('should not match when severity codes improve', () => {
    const signals = [
      signal([
        entry('2026-07-07', 'severe'),
        entry('2026-07-08', 'moderate'),
        entry('2026-07-09', 'mild'),
      ]),
    ];

    expect(rule.match(signals, buildContext())).toBeNull();
  });

  it('groups by symptom code, so a language switch does not split a symptom', () => {
    const signals = [
      signal([
        entry('2026-07-07', 'mild', { title: '头痛' }),
        // 同一条症状换了应用语言后标题变了，码不变。
        entry('2026-07-08', 'moderate', { title: 'Headache' }),
        entry('2026-07-09', 'severe', { title: 'Headache' }),
      ]),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.copyGeneration.params['symptomTitle']).toBe('Headache');
  });

  it('groups by symptom code rather than by display title', () => {
    const signals = [
      signal([
        // 同标题不同码：按码分组后 headache = [mild, mild] 无升高、dizzy 只有一条；
        // 若还按标题分组，这里会被读成 mild → severe → mild 的"先升后降"而误命中。
        entry('2026-07-07', 'mild', { symptom: 'headache', title: '不舒服' }),
        entry('2026-07-08', 'severe', { symptom: 'dizzy', title: '不舒服' }),
        entry('2026-07-09', 'mild', { symptom: 'headache', title: '不舒服' }),
      ]),
    ];

    expect(rule.match(signals, buildContext())).toBeNull();
  });

  it('skips unknown severity instead of scoring it as minimal', () => {
    const signals = [
      signal([
        entry('2026-07-07', 'mild'),
        // 用户明确说判断不了：跳过，不能当成"很轻"。
        entry('2026-07-08', 'unknown'),
        entry('2026-07-09', 'severe'),
      ]),
    ];

    const candidate = rule.match(signals, buildContext());
    expect(candidate).not.toBeNull();
    expect(candidate!.copyGeneration.params['latestValue']).toBe('轻度');
  });

  it('does not match when fewer than two known severities exist', () => {
    const signals = [
      signal([
        entry('2026-07-07', 'unknown'),
        entry('2026-07-08', 'unknown'),
        entry('2026-07-09', 'severe'),
      ]),
    ];

    expect(rule.match(signals, buildContext())).toBeNull();
  });

  it('no longer infers severity from free text in value/note', () => {
    const signals = [
      signal([
        entry('2026-07-07', null, { value: '2/5' }),
        entry('2026-07-08', null, { value: '3/5' }),
        entry('2026-07-09', null, { value: '4/5' }),
      ]),
    ];

    expect(rule.match(signals, buildContext())).toBeNull();
  });

  it('ignores entries without a symptom code', () => {
    const signals = [
      signal([
        entry('2026-07-07', 'mild', { symptom: null }),
        entry('2026-07-08', 'moderate', { symptom: null }),
        entry('2026-07-09', 'severe', { symptom: null }),
      ]),
    ];

    expect(rule.match(signals, buildContext())).toBeNull();
  });
});
