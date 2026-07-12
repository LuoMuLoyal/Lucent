import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { mailConfig } from '../config/mail.config';
import { MailTransportService } from './mail-transport.service';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

import * as nodemailer from 'nodemailer';

type MailConfigType = ConfigType<typeof mailConfig>;

function buildConfig(overrides: Partial<MailConfigType> = {}): MailConfigType {
  return {
    driver: 'log',
    host: '',
    port: 587,
    user: '',
    pass: '',
    from: 'noreply@example.com',
    queue: {
      maxAttempts: 3,
      backoffDelayMs: 5000,
      workerConcurrency: 3,
      completeAgeSeconds: 86400,
      failAgeSeconds: 604800,
      completeMaxCount: 1000,
      failMaxCount: 5000,
    },
    ...overrides,
  };
}

describe('MailTransportService', () => {
  let loggerLogSpy: vi.SpyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    loggerLogSpy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerLogSpy.mockRestore();
  });

  it('does not create an SMTP transporter when driver is log', () => {
    const config = buildConfig({ driver: 'log' });

    new MailTransportService(config);

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('creates an SMTP transporter when driver is smtp', () => {
    const config = buildConfig({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 465,
      user: 'user@example.com',
      pass: 'secret-pass',
    });

    const mockTransporter = { sendMail: vi.fn() };
    (nodemailer.createTransport as vi.Mock).mockReturnValue(mockTransporter);

    new MailTransportService(config);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: {
        user: 'user@example.com',
        pass: 'secret-pass',
      },
    });
  });

  it('sets secure=false for non-465 ports', () => {
    const config = buildConfig({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      user: 'user@example.com',
      pass: 'secret-pass',
    });

    (nodemailer.createTransport as vi.Mock).mockReturnValue({
      sendMail: vi.fn(),
    });

    new MailTransportService(config);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false }),
    );
  });

  it('logs the email content when driver is log', async () => {
    const config = buildConfig({ driver: 'log' });
    const service = new MailTransportService(config);

    await service.send('user@example.com', 'Test Subject', '<p>Hello</p>');

    expect(loggerLogSpy).toHaveBeenCalledTimes(2);
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('user@example.com'),
    );
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Test Subject'),
    );
  });

  it('sends email via transporter when driver is smtp', async () => {
    const mockSendMail = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as vi.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const config = buildConfig({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      user: 'user@example.com',
      pass: 'secret-pass',
      from: 'noreply@lumos.app',
    });
    const service = new MailTransportService(config);

    await service.send('recipient@example.com', 'Welcome', '<p>Welcome!</p>');

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'noreply@lumos.app',
      to: 'recipient@example.com',
      subject: 'Welcome',
      html: '<p>Welcome!</p>',
    });
  });

  it('logs a success message after sending via SMTP', async () => {
    const mockSendMail = vi.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as vi.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const config = buildConfig({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      user: 'user@example.com',
      pass: 'secret-pass',
    });
    const service = new MailTransportService(config);

    await service.send('recipient@example.com', 'Hello', '<p>Hi</p>');

    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('recipient@example.com'),
    );
  });

  it('throws when driver is smtp but transporter is not initialized', async () => {
    // Simulate a misconfigured state: driver is smtp but createTransport
    // returned null/undefined
    (nodemailer.createTransport as vi.Mock).mockReturnValue(null);

    const config = buildConfig({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      user: 'user@example.com',
      pass: 'secret-pass',
    });
    const service = new MailTransportService(config);

    await expect(
      service.send('to@example.com', 'Subject', '<p>Body</p>'),
    ).rejects.toThrow('Mail transporter not initialized');
  });

  it('propagates errors from transporter.sendMail', async () => {
    const sendError = new Error('SMTP connection refused');
    const mockSendMail = vi.fn().mockRejectedValue(sendError);
    (nodemailer.createTransport as vi.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const config = buildConfig({
      driver: 'smtp',
      host: 'smtp.example.com',
      port: 587,
      user: 'user@example.com',
      pass: 'secret-pass',
    });
    const service = new MailTransportService(config);

    await expect(
      service.send('to@example.com', 'Subject', '<p>Body</p>'),
    ).rejects.toThrow('SMTP connection refused');
  });
});
