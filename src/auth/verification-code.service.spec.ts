import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Cache } from 'cache-manager';

import { VerificationCodeService } from './verification-code.service';
import { MailService } from '../mail/mail.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ResultCode } from '../common/api-envelope';

describe('VerificationCodeService', () => {
  let service: VerificationCodeService;
  let cache: jest.Mocked<Cache>;
  let mailService: jest.Mocked<MailService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationCodeService,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendVerificationCode: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(VerificationCodeService);
    cache = module.get(CACHE_MANAGER);
    mailService = module.get(MailService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('send', () => {
    it('should generate code, store in cache, set cooldown, and send email', async () => {
      (cache.get as jest.Mock).mockResolvedValue(undefined); // no cooldown
      (cache.set as jest.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      await service.send('test@example.com', 'register');

      // Should set code in cache (5 min TTL)
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:register:test@example.com',
        expect.stringMatching(/^\d{6}$/), // 6-digit code
        300_000,
      );

      // Should set cooldown in cache (60s TTL)
      expect(cache.set).toHaveBeenCalledWith(
        'vcode:cd:register:test@example.com',
        '1',
        60_000,
      );

      // Should send email
      expect(mailService.sendVerificationCode).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should throw BadRequestException if in cooldown', async () => {
      (cache.get as jest.Mock).mockResolvedValue('1'); // in cooldown

      await expect(service.send('test@example.com', 'login')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw with VERIFICATION_CODE_COOLDOWN code', async () => {
      (cache.get as jest.Mock).mockResolvedValue('1');

      try {
        await service.send('test@example.com', 'login');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          code: number;
        };
        expect(response.code).toBe(ResultCode.VERIFICATION_CODE_COOLDOWN);
      }
    });
  });

  describe('verify', () => {
    it('should return true for correct code and delete from cache', async () => {
      (cache.get as jest.Mock).mockResolvedValue('123456');
      (cache.del as jest.Mock).mockResolvedValue(undefined);

      const result = await service.verify(
        'test@example.com',
        '123456',
        'register',
      );

      expect(result).toBe(true);
      expect(cache.del).toHaveBeenCalledWith('vcode:register:test@example.com');
    });

    it('should throw BadRequestException if code expired (not in cache)', async () => {
      (cache.get as jest.Mock).mockResolvedValue(undefined);

      await expect(
        service.verify('test@example.com', '123456', 'register'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw with VERIFICATION_CODE_INVALID code for expired', async () => {
      (cache.get as jest.Mock).mockResolvedValue(undefined);

      try {
        await service.verify('test@example.com', '123456', 'register');
        fail('Expected BadRequestException');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          code: number;
        };
        expect(response.code).toBe(ResultCode.VERIFICATION_CODE_INVALID);
      }
    });

    it('should throw UnauthorizedException for wrong code', async () => {
      (cache.get as jest.Mock).mockResolvedValue('654321');

      await expect(
        service.verify('test@example.com', '123456', 'register'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw with VERIFICATION_CODE_INVALID code for wrong code', async () => {
      (cache.get as jest.Mock).mockResolvedValue('654321');

      try {
        await service.verify('test@example.com', '123456', 'register');
        fail('Expected UnauthorizedException');
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
      (cache.get as jest.Mock).mockResolvedValue('111111');
      (cache.del as jest.Mock).mockResolvedValue(undefined);

      await service.verify('user@test.com', '111111', 'login');

      expect(cache.get).toHaveBeenCalledWith('vcode:login:user@test.com');
      expect(cache.del).toHaveBeenCalledWith('vcode:login:user@test.com');
    });

    it('should use correct cache key format for cooldown', async () => {
      (cache.get as jest.Mock).mockResolvedValue(undefined);
      (cache.set as jest.Mock).mockResolvedValue(undefined);
      mailService.sendVerificationCode.mockResolvedValue(undefined);

      await service.send('user@test.com', 'reset-password');

      expect(cache.get).toHaveBeenCalledWith(
        'vcode:cd:reset-password:user@test.com',
      );
    });
  });
});
