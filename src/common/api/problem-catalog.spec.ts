import type { I18nService } from 'nestjs-i18n';
import { ProblemCatalog } from './problem-catalog';

describe('ProblemCatalog', () => {
  it('builds a localized stable Problem Details entry', () => {
    const i18n = {
      t: vi.fn(
        (key: string, options?: { lang?: string }) =>
          `${key}@${options?.lang ?? 'missing'}`,
      ),
    } as unknown as I18nService;
    const catalog = new ProblemCatalog(i18n);

    const result = catalog.build('AUTH_TOKEN_EXPIRED', {
      lang: 'zh-CN',
    });

    expect(result).toEqual({
      type: 'https://api.lumos.example/problems/auth-token-expired',
      title: 'common.problem_auth_token_expired_title@zh-CN',
      detail: 'common.problem_auth_token_expired_detail@zh-CN',
      code: 'AUTH_TOKEN_EXPIRED',
      retryable: false,
    });
    expect(i18n.t).toHaveBeenNthCalledWith(
      1,
      'common.problem_auth_token_expired_title',
      { lang: 'zh-CN' },
    );
    expect(i18n.t).toHaveBeenNthCalledWith(
      2,
      'common.problem_auth_token_expired_detail',
      { lang: 'zh-CN' },
    );
  });

  it('defines actionable retry metadata for dependency failures', () => {
    const i18n = {
      t: vi.fn((key: string) => key),
    } as unknown as I18nService;
    const catalog = new ProblemCatalog(i18n);

    expect(
      catalog.build('DEPENDENCY_UNAVAILABLE', {
        lang: 'en',
        retryAfter: 5,
      }),
    ).toEqual({
      type: 'https://api.lumos.example/problems/dependency-unavailable',
      title: 'common.problem_dependency_unavailable_title',
      detail: 'common.problem_dependency_unavailable_detail',
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
      retryAfter: 5,
    });
  });

  it('rejects unknown codes instead of manufacturing a vague 500', () => {
    const i18n = { t: vi.fn() } as unknown as I18nService;
    const catalog = new ProblemCatalog(i18n);

    expect(() =>
      catalog.build('NOT_A_DOCUMENTED_CODE', { lang: 'en' }),
    ).toThrow('Unknown Problem Details code');
  });
});
