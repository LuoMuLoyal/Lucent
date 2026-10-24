import { describe, expect, it } from 'vitest';

import { exceedsHalfLifeGap, parseHalfLife } from './half-life.js';

/**
 * 半衰期解析。
 *
 * ## 夹具来自真实数据
 *
 * 下面的用例大多是 dev 库 `drugbank_drugs.half_life` 的**原样样本**，不是
 * 我编的「典型输入」。实测 78 条非空记录里这套解析能覆盖 76 条；剩下 2 条
 * 是语义上就没有半衰期的（somatotropin 的文本被截断、pancrelipase 明确
 * 「不被吸收」），返回 null 是正确行为。
 */
describe('parseHalfLife', () => {
  it('parses a simple range in hours', () => {
    expect(parseHalfLife('4-5 hours')).toEqual({
      lowHours: 4,
      highHours: 5,
      openEnded: false,
    });
  });

  it('parses a decimal range with decimal point values', () => {
    expect(parseHalfLife('8.4-19.3 hrs')).toEqual({
      lowHours: 8.4,
      highHours: 19.3,
      openEnded: false,
    });
  });

  it('parses minutes and converts to hours', () => {
    // 分钟值必须换算：不换算会让「112 minutes」被当成 112 小时。
    const parsed = parseHalfLife('112 minutes');
    expect(parsed).toMatchObject({ lowHours: 112 / 60, highHours: 112 / 60 });
  });

  it('parses days and converts to hours', () => {
    expect(parseHalfLife('3 days')).toMatchObject({
      lowHours: 72,
      highHours: 72,
    });
  });

  it('expands a plus-minus value into a range around the centre', () => {
    // `25 ± 10 hours` 是「中心 ± 偏差」，不是区间 25..10。取错会让下界变成 25，
    // 判定阈值直接翻倍。
    expect(parseHalfLife('25 +/- 10 hours')).toMatchObject({
      lowHours: 15,
      highHours: 35,
    });
    expect(parseHalfLife('25 ± 10 hours')).toMatchObject({
      lowHours: 15,
      highHours: 35,
    });
  });

  it('strips prose around the value (real DrugBank samples)', () => {
    const parsed = parseHalfLife(
      'Etanercept has a mean half-life of elimination of 102 hours in RA patients. ' +
        'Population models have shown a mean half-life of 68 hours in healthy adults.',
    );
    // 取**第一次**出现的值：那是主句的结论，后面的从句往往是亚组数据。
    expect(parsed).toMatchObject({ lowHours: 102, highHours: 102 });
  });

  it('parses english number words', () => {
    // 真实样本：「Leuprolide has a terminal elimination half-life of approximately three hours.」
    expect(
      parseHalfLife(
        'Leuprolide has a terminal elimination half-life of approximately three hours.',
      ),
    ).toMatchObject({ lowHours: 3, highHours: 3 });
  });

  it('marks open-ended comparisons', () => {
    // `>20 hours` 的 20 是下界而不是精确值；判定时必须按保守口径用。
    expect(
      parseHalfLife('>20 hours (mammalian reticulocytes, in vitro).'),
    ).toMatchObject({
      lowHours: 20,
      openEnded: true,
    });
  });

  it('keeps a range when the prose gives one', () => {
    // 真实样本：「...is 164 in a range of 84-353 hours」。
    // 保留区间比取 164 更诚实——单值会把不确定性伪装成精确。
    expect(
      parseHalfLife(
        'The mean terminal half-life of peginterferon alfa-2a is 164 in a range of 84-353 hours.',
      ),
    ).toMatchObject({ lowHours: 84, highHours: 353 });
  });

  it('returns null when the text carries no numeric half-life', () => {
    // 空值与纯描述都是「没有可用数据」，调用方据此跳过，**不要**回落到默认值——
    // 那等于给一个我们自己编的生理参数。
    expect(parseHalfLife(null)).toBeNull();
    expect(parseHalfLife(undefined)).toBeNull();
    expect(parseHalfLife('   ')).toBeNull();
    expect(parseHalfLife('Not applicable.')).toBeNull();
  });

  it('returns null for a text that only says the drug is not absorbed', () => {
    // 真实样本：pancrelipase 这段没有任何数值，语义上也没有半衰期可言。
    expect(
      parseHalfLife(
        'Pancrelipase acts locally in the GI tract and it is not absorbed in any significant amount.',
      ),
    ).toBeNull();
  });
});

describe('exceedsHalfLifeGap', () => {
  const range = { lowHours: 8, highHours: 20, openEnded: false };

  it('uses the UPPER bound so wide ranges do not trigger early', () => {
    // 8-20 小时 → 上界的一半是 10 小时。缺口 9.9 不提示，10 提示。
    // 若误用下界（4）或中值（7），这两条断言都会失败。
    expect(exceedsHalfLifeGap(range, 9.9)).toBe(false);
    expect(exceedsHalfLifeGap(range, 10)).toBe(true);
  });

  it('does not fire on a zero half-life parsed from bad data', () => {
    expect(
      exceedsHalfLifeGap({ lowHours: 0, highHours: 0, openEnded: false }, 100),
    ).toBe(false);
  });

  it('treats the boundary as inclusive', () => {
    expect(
      exceedsHalfLifeGap({ lowHours: 10, highHours: 10, openEnded: false }, 5),
    ).toBe(true);
    expect(
      exceedsHalfLifeGap(
        { lowHours: 10, highHours: 10, openEnded: false },
        4.9,
      ),
    ).toBe(false);
  });
});
