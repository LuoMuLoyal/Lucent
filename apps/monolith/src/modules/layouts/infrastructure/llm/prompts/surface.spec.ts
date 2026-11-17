import { toContentLocale } from './surface.js';

/**
 * Language-normalisation tests.
 *
 * The prompt must receive a single, known language — never the raw header,
 * which for browsers is a weighted list. Feeding that list to a model invites
 * mixed-language output, and a wrong language here means a Chinese user gets an
 * English surface.
 */
describe('toContentLocale', () => {
  it.each([
    ['zh-CN', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-CN,zh;q=0.9,en;q=0.8', 'zh-CN'],
    ['ZH-cn', 'zh-CN'],
  ])('maps %s to %s', (input, expected) => {
    expect(toContentLocale(input)).toBe(expected);
  });

  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB,en;q=0.9', 'en'],
    ['fr-FR', 'en'],
    ['ja', 'en'],
  ])('falls back to en for %s', (input, expected) => {
    expect(toContentLocale(input)).toBe(expected);
  });

  it('falls back to en when the language is missing', () => {
    // Matches `fallbackLanguage: 'en'` in the i18n module: error copy and
    // generated copy must not disagree about the app's language.
    expect(toContentLocale(undefined)).toBe('en');
  });
});
