import type { MailQueueService } from './mail-queue.service';
import { MailService } from './mail.service';
import {
  VERIFICATION_CODE_SUBJECT,
  renderVerificationCodeEmail,
} from './templates';

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

  it('should enqueue verification code mail', async () => {
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
      subject: VERIFICATION_CODE_SUBJECT,
      html: renderVerificationCodeEmail(TEST_VERIFICATION_CODE),
    });
  });

  it('should render bilingual verification code email', () => {
    const html = renderVerificationCodeEmail(TEST_VERIFICATION_CODE);

    // Contains the verification code
    expect(html).toContain(TEST_VERIFICATION_CODE);

    // Contains DOCTYPE for email client compatibility
    expect(html).toContain('<!DOCTYPE html>');

    // Contains inline styles (email-safe)
    expect(html).toContain('style=');

    // ── Chinese content ──
    expect(html).toContain('邮箱验证');
    expect(html).toContain('您的验证码是');
    expect(html).toContain('5 分钟内有效');
    expect(html).toContain('请勿将验证码泄露给他人');
    expect(html).toContain('如果您没有发起此操作');

    // ── English content ──
    expect(html).toContain('verifying your email');
    expect(html).toContain('Your verification code is');
    expect(html).toContain('expires in 5 minutes');
    expect(html).toContain('Do not share this code');
    expect(html).toContain('If you did not request this');

    // ── Bilingual footer ──
    expect(html).toContain('请勿直接回复');
    expect(html).toContain('please do not reply');
  });
});
