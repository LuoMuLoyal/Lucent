import type { MailQueueService } from './mail-queue.service.js';
import { MailService } from './mail.service.js';
import {
  renderVerificationCodeEmail,
  verificationCodeSubject,
} from './templates.js';

describe('MailService', () => {
  const TEST_VERIFICATION_CODE = '123456';

  it('should enqueue generic mail', async () => {
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailQueueService>;
    const service = new MailService(queue);

    await service.send('user@example.com', 'Subject', '<p>Body</p>');

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    });
  });

  it('should enqueue verification code mail (default en)', async () => {
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailQueueService>;
    const service = new MailService(queue);

    await service.sendVerificationCode(
      'user@example.com',
      TEST_VERIFICATION_CODE,
    );

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: verificationCodeSubject(),
      html: renderVerificationCodeEmail(TEST_VERIFICATION_CODE),
    });
  });

  it('should pass the locale through to the template', async () => {
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<MailQueueService>;
    const service = new MailService(queue);

    await service.sendVerificationCode(
      'user@example.com',
      TEST_VERIFICATION_CODE,
      'zh-CN',
    );

    expect(queue.enqueue).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: verificationCodeSubject('zh-CN'),
      html: renderVerificationCodeEmail(TEST_VERIFICATION_CODE, 5, 'zh-CN'),
    });
  });

  it('should render the English verification code email (default)', () => {
    const html = renderVerificationCodeEmail(TEST_VERIFICATION_CODE);

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

  it('should treat the bare zh locale as Chinese', () => {
    const html = renderVerificationCodeEmail(TEST_VERIFICATION_CODE, 5, 'zh');

    expect(html).toContain('您的验证码是');
    expect(html).not.toContain('Your verification code is');
  });

  it('should fall back to English for unsupported locales', () => {
    const html = renderVerificationCodeEmail(TEST_VERIFICATION_CODE, 5, 'fr');

    expect(html).toContain('Your verification code is');
    expect(html).not.toContain('您的验证码是');
  });
});
