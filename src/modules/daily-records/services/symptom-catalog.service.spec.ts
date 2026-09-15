import type { I18nService } from 'nestjs-i18n';
import { SymptomCatalogService } from './symptom-catalog.service.js';
import { SYMPTOM_CATALOG_CODES } from '../constants/symptom-catalog.constants.js';

/** i18n fake：把 `symptom-catalog.<code>` 翻成 `<label>[<lang>]`，便于断言顺序与语言。 */
function buildI18n(lang = 'zh-CN', labels: Record<string, string> = {}) {
  return {
    t: vi.fn((key: string) => {
      const code = key.replace('symptom-catalog.', '');
      return `${labels[code] ?? code}[${lang}]`;
    }),
  } as unknown as I18nService;
}

describe('SymptomCatalogService', () => {
  it('returns every catalog code in the documented order', () => {
    const service = new SymptomCatalogService(buildI18n());

    const response = service.list();

    expect(response.items.map((item) => item.code)).toEqual([
      ...SYMPTOM_CATALOG_CODES,
    ]);
    expect(response.items).toHaveLength(SYMPTOM_CATALOG_CODES.length);
  });

  it('localizes each label through the symptom-catalog namespace', () => {
    const i18n = buildI18n('zh-CN', { headache: '头痛', other: '其它' });
    const service = new SymptomCatalogService(i18n);

    const response = service.list();

    expect(response.items[0]).toEqual({
      code: 'headache',
      label: '头痛[zh-CN]',
    });
    expect(response.items.at(-1)).toEqual({
      code: 'other',
      label: '其它[zh-CN]',
    });
    expect(i18n.t).toHaveBeenCalledWith('symptom-catalog.insomnia');
  });

  it('reflects the request language resolved by Accept-Language', () => {
    const service = new SymptomCatalogService(
      buildI18n('en', { fever: 'Fever' }),
    );

    const response = service.list();

    expect(response.items.find((item) => item.code === 'fever')).toEqual({
      code: 'fever',
      label: 'Fever[en]',
    });
  });
});
