import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
  argon2id: 2,
}));

import * as argon2 from 'argon2';
import { SecurityPinService } from './security-pin.service';
import { PrismaService } from '../../../prisma/prisma.service';

type MockPrisma = {
  user: {
    update: jest.Mock;
    findUnique: jest.Mock;
  };
};

describe('SecurityPinService', () => {
  let service: SecurityPinService;
  let prisma: MockPrisma;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: 'user-1',
    securityPinEnabled: true,
    securityPinHash: '$argon2id$hashed',
    securityElevationVersion: 3,
    securityPinChangedAt: new Date('2026-07-03T12:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityPinService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              update: jest.fn(),
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({
              accessSecret: 'test-access-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
            }),
          },
        },
        {
          provide: I18nService,
          useValue: {
            t: jest.fn((key: string) => key),
          },
        },
      ],
    }).compile();

    service = module.get(SecurityPinService);
    prisma = module.get(PrismaService) as unknown as MockPrisma;
    jwtService = module.get(JwtService);

    (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$new-hash');
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    prisma.user.update.mockResolvedValue({ id: 'user-1' });
    prisma.user.findUnique.mockResolvedValue(mockUser);
    jwtService.signAsync.mockResolvedValue('mock-elevation-token');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      scope: 'security_elevation',
      version: 3,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enable', () => {
    it('enables a 6-digit PIN with argon2 and bumps elevation version', async () => {
      await service.enable('user-1', { pin: '123456' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            securityPinEnabled: true,
            securityPinHash: expect.any(String),
            securityPinChangedAt: expect.any(Date),
            securityElevationVersion: { increment: 1 },
          }),
        }),
      );
    });

    it('rejects malformed pins', async () => {
      await expect(service.enable('user-1', { pin: '12a456' })).rejects.toThrow(
        BadRequestException,
      );
      expect(argon2.hash).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('returns a 15-minute elevation token after successful verification', async () => {
      const result = await service.verify('user-1', { pin: '123456' });

      expect(result.expiresAt).toBeTruthy();
      expect(result.elevationToken).toEqual(expect.any(String));
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          scope: 'security_elevation',
          version: 3,
        }),
        expect.objectContaining({
          secret: 'test-access-secret',
          expiresIn: 15 * 60,
          algorithm: 'HS512',
          issuer: 'test-issuer',
          audience: 'test-audience',
        }),
      );
    });

    it('rejects malformed pins before hash work', async () => {
      await expect(service.verify('user-1', { pin: '12a456' })).rejects.toThrow(
        BadRequestException,
      );
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('rejects when PIN is not enabled', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        securityPinEnabled: false,
        securityPinHash: null,
      });

      await expect(service.verify('user-1', { pin: '123456' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects when PIN verification fails', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.verify('user-1', { pin: '123456' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('change', () => {
    it('requires the old PIN and bumps elevation version', async () => {
      await service.change('user-1', { oldPin: '123456', newPin: '654321' });

      expect(argon2.verify).toHaveBeenCalledWith('$argon2id$hashed', '123456');
      expect(argon2.hash).toHaveBeenCalledWith('654321', expect.any(Object));
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            securityPinHash: '$argon2id$new-hash',
            securityElevationVersion: { increment: 1 },
          }),
        }),
      );
    });

    it('rejects when old PIN is wrong', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.change('user-1', { oldPin: '000000', newPin: '654321' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('disable', () => {
    it('disables PIN and clears stored hash when PIN matches', async () => {
      await service.disable('user-1', { pin: '123456' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            securityPinEnabled: false,
            securityPinHash: null,
            securityPinChangedAt: null,
            securityElevationVersion: { increment: 1 },
          }),
        }),
      );
    });
  });

  describe('getStatus', () => {
    it('returns PIN state without secrets', async () => {
      const status = await service.getStatus('user-1');

      expect(status.enabled).toBe(true);
      expect(status.lastChangedAt).toBe('2026-07-03T12:00:00.000Z');
    });
  });

  describe('verifyElevationToken', () => {
    it('accepts a valid elevation token with matching version and subject', async () => {
      const payload = await service.verifyElevationToken('token', 'user-1');

      expect(payload.sub).toBe('user-1');
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
        secret: 'test-access-secret',
        algorithms: ['HS512'],
        issuer: 'test-issuer',
        audience: 'test-audience',
      });
    });

    it('rejects when token version is stale after PIN change', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        scope: 'security_elevation',
        version: 2,
      });

      await expect(
        service.verifyElevationToken('token', 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when token subject does not match', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'other-user',
        scope: 'security_elevation',
        version: 3,
      });

      await expect(
        service.verifyElevationToken('token', 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when token scope is wrong', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        scope: 'other',
        version: 3,
      });

      await expect(
        service.verifyElevationToken('token', 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
