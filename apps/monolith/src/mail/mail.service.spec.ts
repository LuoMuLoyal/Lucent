import type { I18nService } from 'nestjs-i18n';
import type { MailQueueService } from './mail-queue.service.js';
import { MailService } from './mail.service.js';
import {
  renderVerificationCodeEmail,
  resolveEmailLocale,
  verificationCodeSubject,
} from './templates.js';
import { makeTestI18n } from '../common/tests/test-i18n.js';

/** Translator backed by the shipped `mail.json` dictionaries. */
const i18n = makeTestI18n() as unknown as I18nService;

const TEST_VERIFICATION_CODE = '123456';

describe('MailService', () => {
  function buildQueue() {
    return {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailQueueService>;
  }

  it('should enqueue generic mail', async () => {
    const queue = buildQueue();
    const service = new MailService(queue, i18n);

    await service.send('user@example.com', 'Subject', '<p>Body</p>');

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    });
  });

  it('should enqueue verification code mail (default en)', async () => {
    const queue = buildQueue();
    const service = new MailService(queue, i18n);

    await service.sendVerificationCode(
      'user@example.com',
      TEST_VERIFICATION_CODE,
    );

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: verificationCodeSubject(i18n),
      html: renderVerificationCodeEmail(i18n, TEST_VERIFICATION_CODE),
    });
  });

  it('should pass the locale through to the template', async () => {
    const queue = buildQueue();
    const service = new MailService(queue, i18n);

    await service.sendVerificationCode(
      'user@example.com',
      TEST_VERIFICATION_CODE,
      'zh-CN',
    );

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: verificationCodeSubject(i18n, 'zh-CN'),
      html: renderVerificationCodeEmail(
        i18n,
        TEST_VERIFICATION_CODE,
        5,
        'zh-CN',
      ),
    });
  });

  it('should render the English verification code email (default)', () => {
    const html = renderVerificationCodeEmail(i18n, TEST_VERIFICATION_CODE);

    // Contains the verification code
    expect(html).toContain(TEST_VERIFICATION_CODE);

    // Contains DOCTYPE for email client compatibility
    expect(html).toContain('<!DOCTYPE html>');

    // Contains inline styles (email-safe)
    expect(html).toContain('style=');

    // ── English content ──
    expect(html).toContain('verifying your email');
    expect(html).toContain('Your verification code is');
    expect(html).toContain('expires in 5 minutes');
    expect(html).toContain('Do not share this code');
    expect(html).toContain('If you did not request this');

    // ── English footer ──
    expect(html).toContain('please do not reply');

    // No Chinese content in English mode
    expect(html).not.toContain('您的验证码是');
    expect(html).not.toContain('请勿将验证码泄露给他人');
  });

  it('should render the Chinese verification code email when locale is zh-CN', () => {
    const html = renderVerificationCodeEmail(
      i18n,
      TEST_VERIFICATION_CODE,
      5,
      'zh-CN',
    );

    // Contains the verification code
    expect(html).toContain(TEST_VERIFICATION_CODE);

    // ── Chinese content ──
    expect(html).toContain('邮箱验证');
    expect(html).toContain('您的验证码是');
    expect(html).toContain('5 分钟内有效');
    expect(html).toContain('请勿将验证码泄露给他人');
    expect(html).toContain('如果您没有发起此操作');

    // ── Chinese footer ──
    expect(html).toContain('请勿直接回复');

    // No English content in Chinese mode
    expect(html).not.toContain('Your verification code is');
    expect(html).not.toContain('Do not share this code');
  });

  it('should fall back to English for unsupported locales', () => {
    const html = renderVerificationCodeEmail(
      i18n,
      TEST_VERIFICATION_CODE,
      5,
      'fr',
    );

    expect(html).toContain('Your verification code is');
    expect(html).not.toContain('您的验证码是');
  });
});

/**
 * The locale resolver used to accept only `zh-CN`/`zh`, so every other Chinese
 * tag fell through to English — while the rest of the product maps `zh-*` to
 * Chinese via `resolveLocale`. One request could therefore produce an English
 * email and a Chinese in-app message.
 */
describe('resolveEmailLocale', () => {
  it.each(['zh-CN', 'zh', 'zh-Hans', 'zh-TW', 'zh_CN', 'ZH-cn'])(
    'treats %s as Chinese',
    (tag) => {
      expect(resolveEmailLocale(tag)).toBe('zh-CN');
    },
  );

  it.each(['en', 'en-US', 'fr', '', undefined])(
    'falls back to English for %s',
    (tag) => {
      expect(resolveEmailLocale(tag)).toBe('en');
    },
  );

  it('renders Chinese for a zh-Hans client', () => {
    // The concrete regression: this used to render the English email.
    const html = renderVerificationCodeEmail(
      i18n,
      TEST_VERIFICATION_CODE,
      5,
      'zh-Hans',
    );

    expect(html).toContain('您的验证码是');
    expect(html).not.toContain('Your verification code is');
  });
});
