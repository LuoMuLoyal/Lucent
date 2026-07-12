import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

import { I18nService } from 'nestjs-i18n';
import { VerificationCodeService } from './verification-code.service';
import { MailService } from '../../../mail/mail.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ResultCode } from '../../../common/api';
import {
  DEFAULT_VERIFICATION_CODE_LENGTH,
  DEFAULT_VERIFICATION_CODE_TTL_MS,
  DEFAULT_VERIFICATION_COOLDOWN_MS,
  DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
  DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
} from '../../../config/constants';

describe('VerificationCodeService', () => {
  let service: VerificationCodeService;
  let cache: vi.Mocked<Cache>;
  let mailService: vi.Mocked<MailService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationCodeService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: vi.fn(),
            set: vi.fn(),
            del: vi.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationCode: vi.fn(),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: vi.fn((key: string) => key),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string, fallback?: unknown) => {
              if (key === 'VERIFICATION_CODE_TTL_MS')
                return DEFAULT_VERIFICATION_CODE_TTL_MS;
              if (key === 'VERIFICATION_COOLDOWN_MS')
                return DEFAULT_VERIFICATION_COOLDOWN_MS;
              if (key === 'VERIFICATION_RATE_LIMIT_WINDOW_MS')
                return DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS;
              if (key === 'VERIFICATION_RATE_LIMIT_MAX')
                return DEFAULT_VERIFICATION_RATE_LIMIT_MAX;
              if (key === 'VERIFICATION_CODE_LENGTH')
                return DEFAULT_VERIFICATION_CODE_LENGTH;
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(VerificationCodeService);
    cache = module.get(CACHE_MANAGER);
    mailService = module.get(MailService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('send', () => {
    it('should generate code, store in cache, set cooldown, and send email', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined); // no cooldown
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      await service.send('test@example.com', 'register');

      // Should set code in cache (5 min TTL)
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:register:test@example.com',
        expect.stringMatching(/^\d{6}$/), // 6-digit code
        DEFAULT_VERIFICATION_CODE_TTL_MS,
      );

      // Should set cooldown in cache (60s TTL)
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:cd:register:test@example.com',
        '1',
        DEFAULT_VERIFICATION_COOLDOWN_MS,
      );

      // Should send email
      expect(mailService.sendVerificationCode).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should throw BadRequestException if in cooldown', async () => {
      (cache.get as vi.Mock).mockResolvedValue('1'); // in cooldown

      await expect(service.send('test@example.com', 'login')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw with VERIFICATION_CODE_COOLDOWN code', async () => {
      (cache.get as vi.Mock).mockResolvedValue('1');

      try {
        await service.send('test@example.com', 'login');
        expect.fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          code: number;
        };
        expect(response.code).toBe(ResultCode.VERIFICATION_CODE_COOLDOWN);
      }
    });

    it('should store a client rate limit bucket when client key is provided', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      await service.send('test@example.com', 'register', '127.0.0.1');

      expect(cache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^vcode:rl:client:[a-f0-9]{64}$/),
        expect.objectContaining({
          count: 1,
          resetAt: expect.any(Number) as number,
        }),
        DEFAULT_VERIFICATION_RATE_LIMIT_WINDOW_MS,
      );
    });

    it('should throw 429 when client rate limit is exceeded', async () => {
      const resetAt = Date.now() + 60_000;
      (cache.get as vi.Mock).mockResolvedValue({
        count: DEFAULT_VERIFICATION_RATE_LIMIT_MAX,
        resetAt,
      });

      await expect(
        service.send('test@example.com', 'register', '127.0.0.1'),
      ).rejects.toThrow(HttpException);
      expect(mailService.sendVerificationCode).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('should return true for correct code and delete from cache', async () => {
      (cache.get as vi.Mock).mockResolvedValue('123456');
      (cache.del as vi.Mock).mockResolvedValue(undefined);

      const result = await service.verify(
        'test@example.com',
        '123456',
        'register',
      );

      expect(result).toBe(true);
      expect(cache.del).toHaveBeenCalledWith('vcode:register:test@example.com');
    });

    it('should throw BadRequestException if code expired (not in cache)', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);

      await expect(
        service.verify('test@example.com', '123456', 'register'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw with VERIFICATION_CODE_INVALID code for expired', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);

      try {
        await service.verify('test@example.com', '123456', 'register');
        expect.fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          code: number;
        };
        expect(response.code).toBe(ResultCode.VERIFICATION_CODE_INVALID);
      }
    });

    it('should throw UnauthorizedException for wrong code', async () => {
      (cache.get as vi.Mock).mockResolvedValue('654321');

      await expect(
        service.verify('test@example.com', '123456', 'register'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw with VERIFICATION_CODE_INVALID code for wrong code', async () => {
      (cache.get as vi.Mock).mockResolvedValue('654321');

      try {
        await service.verify('test@example.com', '123456', 'register');
        expect.fail('Expected UnauthorizedException');
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse() as {
          code: number;
        };
        expect(response.code).toBe(ResultCode.VERIFICATION_CODE_INVALID);
      }
    });
  });

  describe('cache key format', () => {
    it('should use correct cache key format for code', async () => {
      (cache.get as vi.Mock).mockResolvedValue('111111');
      (cache.del as vi.Mock).mockResolvedValue(undefined);

      await service.verify('user@test.com', '111111', 'login');

      expect(cache.get).toHaveBeenCalledWith('vcode:login:user@test.com');
      expect(cache.del).toHaveBeenCalledWith('vcode:login:user@test.com');
    });

    it('should use correct cache key format for cooldown', async () => {
      (cache.get as vi.Mock).mockResolvedValue(undefined);
      (cache.set as vi.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      await service.send('user@test.com', 'reset-password');

      expect(cache.get).toHaveBeenCalledWith(
        'vcode:cd:reset-password:user@test.com',
      );
    });
  });
});
