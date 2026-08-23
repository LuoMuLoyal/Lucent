import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '#generated/prisma/client';

vi.mock('argon2', () => ({
  hash: vi.fn(),
  verify: vi.fn(),
  argon2id: 2,
}));

import * as argon2 from 'argon2';
import { SecurityPinService } from './pin.service';
import { PrismaService } from '../../../prisma';
import {
  createDomainFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';

type MockPrisma = {
  user: {
    update: vi.Mock;
    findFirst: vi.Mock;
  };
  nonDeleted: {
    user: {
      findFirst: vi.Mock;
    };
  };
};

/**
 * Folds a ResultAsync into a plain outcome so specs can assert both success
 * values and DomainFailure codes without throwing.
 */
function collectResult<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

function elevationRequired(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_ELEVATION_REQUIRED',
  });
}

function elevationTokenInvalid(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_ELEVATION_TOKEN_INVALID',
  });
}

function validationFailed(): DomainFailure {
  return createDomainFailure({
    kind: 'validation',
    code: 'VALIDATION_FAILED',
  });
}

describe('SecurityPinService', () => {
  let service: SecurityPinService;
  let prisma: MockPrisma;
  let jwtService: vi.Mocked<JwtService>;

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
          useValue: (() => {
            const userFindFirst = vi.fn();
            return {
              user: {
                update: vi.fn(),
                findFirst: userFindFirst,
              },
              nonDeleted: {
                user: {
                  findFirst: userFindFirst,
                },
              },
            };
          })(),
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: vi.fn(),
            verifyAsync: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn().mockReturnValue({
              accessSecret: 'test-access-secret',
              issuer: 'test-issuer',
              audience: 'test-audience',
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SecurityPinService);
    prisma = module.get(PrismaService) as unknown as MockPrisma;
    jwtService = module.get(JwtService);

    (argon2.hash as vi.Mock).mockResolvedValue('$argon2id$new-hash');
    (argon2.verify as vi.Mock).mockResolvedValue(true);
    prisma.user.update.mockResolvedValue({ id: 'user-1' });
    prisma.user.findFirst.mockResolvedValue(mockUser);
    jwtService.signAsync.mockResolvedValue('mock-elevation-token');
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      scope: 'security_elevation',
      version: 3,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('enable', () => {
    it('enables a 6-digit PIN with argon2 and bumps elevation version', async () => {
      const outcome = await collectResult(
        service.enable('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({ ok: true });
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

    it.each(['12a456', '12345', '1234567', ''])(
      'rejects malformed pin %j with VALIDATION_FAILED',
      async (pin) => {
        const outcome = await collectResult(service.enable('user-1', { pin }));

        expect(outcome).toMatchObject({ ok: false, error: validationFailed() });
        expect(argon2.hash).not.toHaveBeenCalled();
      },
    );

    it('maps a missing user (P2025) to RESOURCE_NOT_FOUND', async () => {
      const error = Object.create(
        Prisma.PrismaClientKnownRequestError.prototype,
      );
      error.code = 'P2025';
      prisma.user.update.mockRejectedValue(error);

      const outcome = await collectResult(
        service.enable('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          kind: 'not_found',
        },
      });
    });

    it('rethrows unknown argon2.hash failures instead of folding them into a PIN failure', async () => {
      (argon2.hash as vi.Mock).mockRejectedValue(
        new Error('argon2 native binding failed'),
      );

      await expect(
        collectResult(service.enable('user-1', { pin: '123456' })),
      ).rejects.toThrow('argon2 native binding failed');
    });

    it('rethrows unknown database failures instead of folding them into a PIN failure', async () => {
      prisma.user.update.mockRejectedValue(new Error('db connection lost'));

      await expect(
        collectResult(service.enable('user-1', { pin: '123456' })),
      ).rejects.toThrow('db connection lost');
    });
  });

  describe('verify', () => {
    it('returns a 15-minute elevation token after successful verification', async () => {
      const outcome = await collectResult(
        service.verify('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({ ok: true });
      const value = outcome.ok ? outcome.value : null;
      expect(value?.expiresAt).toBeTruthy();
      expect(value?.elevationToken).toEqual(expect.any(String));
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

    it('rejects malformed pins before hash work with VALIDATION_FAILED', async () => {
      const outcome = await collectResult(
        service.verify('user-1', { pin: '12a456' }),
      );

      expect(outcome).toMatchObject({ ok: false, error: validationFailed() });
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_ELEVATION_REQUIRED when PIN is not enabled', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        securityPinEnabled: false,
        securityPinHash: null,
      });

      const outcome = await collectResult(
        service.verify('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
    });

    it('rejects with AUTH_ELEVATION_REQUIRED when PIN verification fails', async () => {
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      const outcome = await collectResult(
        service.verify('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rejects with RESOURCE_NOT_FOUND when the user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const outcome = await collectResult(
        service.verify('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: { code: 'RESOURCE_NOT_FOUND', kind: 'not_found' },
      });
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('rethrows argon2.verify failures instead of reporting a wrong PIN', async () => {
      (argon2.verify as vi.Mock).mockRejectedValue(
        new Error('corrupted stored hash'),
      );

      await expect(
        collectResult(service.verify('user-1', { pin: '123456' })),
      ).rejects.toThrow('corrupted stored hash');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('rethrows JWT signing failures instead of reporting a wrong PIN', async () => {
      jwtService.signAsync.mockRejectedValue(new Error('signing failed'));

      await expect(
        collectResult(service.verify('user-1', { pin: '123456' })),
      ).rejects.toThrow('signing failed');
    });
  });

  describe('change', () => {
    it('requires the old PIN and bumps elevation version', async () => {
      const outcome = await collectResult(
        service.change('user-1', { oldPin: '123456', newPin: '654321' }),
      );

      expect(outcome).toMatchObject({ ok: true });
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

    it('rejects with AUTH_ELEVATION_REQUIRED when old PIN is wrong', async () => {
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      const outcome = await collectResult(
        service.change('user-1', { oldPin: '000000', newPin: '654321' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
      expect(argon2.hash).not.toHaveBeenCalled();
    });

    it('rejects with AUTH_ELEVATION_REQUIRED when PIN is not enabled', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        securityPinEnabled: false,
        securityPinHash: null,
      });

      const outcome = await collectResult(
        service.change('user-1', { oldPin: '123456', newPin: '654321' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
    });

    it('rejects malformed new PIN with VALIDATION_FAILED', async () => {
      const outcome = await collectResult(
        service.change('user-1', { oldPin: '123456', newPin: 'abc123' }),
      );

      expect(outcome).toMatchObject({ ok: false, error: validationFailed() });
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('rethrows argon2.verify failures instead of reporting a wrong PIN', async () => {
      (argon2.verify as vi.Mock).mockRejectedValue(
        new Error('argon2 verify failed'),
      );

      await expect(
        collectResult(
          service.change('user-1', { oldPin: '123456', newPin: '654321' }),
        ),
      ).rejects.toThrow('argon2 verify failed');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('disables PIN and clears stored hash when PIN matches', async () => {
      const outcome = await collectResult(
        service.disable('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({ ok: true });
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

    it('rejects with AUTH_ELEVATION_REQUIRED when PIN is not enabled', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        securityPinEnabled: false,
        securityPinHash: null,
      });

      const outcome = await collectResult(
        service.disable('user-1', { pin: '123456' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
    });

    it('rejects with AUTH_ELEVATION_REQUIRED when PIN verification fails', async () => {
      (argon2.verify as vi.Mock).mockResolvedValue(false);

      const outcome = await collectResult(
        service.disable('user-1', { pin: '000000' }),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
    });

    it('rejects malformed pin with VALIDATION_FAILED', async () => {
      const outcome = await collectResult(
        service.disable('user-1', { pin: '12a456' }),
      );

      expect(outcome).toMatchObject({ ok: false, error: validationFailed() });
      expect(argon2.verify).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('returns PIN state without secrets', async () => {
      const outcome = await collectResult(service.getStatus('user-1'));

      expect(outcome).toMatchObject({
        ok: true,
        value: {
          enabled: true,
          lastChangedAt: '2026-07-03T12:00:00.000Z',
        },
      });
    });

    it('returns null lastChangedAt when PIN was never set', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        securityPinEnabled: false,
        securityPinChangedAt: null,
      });

      const outcome = await collectResult(service.getStatus('user-1'));

      expect(outcome).toMatchObject({
        ok: true,
        value: { enabled: false, lastChangedAt: null },
      });
    });

    it('rejects with RESOURCE_NOT_FOUND when the user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const outcome = await collectResult(service.getStatus('missing-user'));

      expect(outcome).toMatchObject({
        ok: false,
        error: { code: 'RESOURCE_NOT_FOUND', kind: 'not_found' },
      });
    });
  });

  describe('verifyElevationToken', () => {
    it('accepts a valid elevation token with matching version and subject', async () => {
      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: true,
        value: { sub: 'user-1', scope: 'security_elevation', version: 3 },
      });
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
        secret: 'test-access-secret',
        algorithms: ['HS512'],
        issuer: 'test-issuer',
        audience: 'test-audience',
      });
    });

    it('rejects with AUTH_ELEVATION_REQUIRED when token version is stale after PIN change', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        scope: 'security_elevation',
        version: 2,
      });

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
    });

    it('rejects with AUTH_ELEVATION_TOKEN_INVALID when the token is expired', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationTokenInvalid(),
      });
    });

    it('rejects with AUTH_ELEVATION_TOKEN_INVALID when the signature is invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationTokenInvalid(),
      });
    });

    it('rejects with AUTH_ELEVATION_TOKEN_INVALID when token subject does not match', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'other-user',
        scope: 'security_elevation',
        version: 3,
      });

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationTokenInvalid(),
      });
    });

    it('rejects with AUTH_ELEVATION_TOKEN_INVALID when token scope is wrong', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        scope: 'other',
        version: 3,
      });

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationTokenInvalid(),
      });
    });

    it('rejects with AUTH_ELEVATION_REQUIRED when PIN is disabled after token was issued', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        securityPinEnabled: false,
      });

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'user-1'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: elevationRequired(),
      });
    });

    it('rejects with RESOURCE_NOT_FOUND when the user no longer exists', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'missing-user',
        scope: 'security_elevation',
        version: 3,
      });

      const outcome = await collectResult(
        service.verifyElevationToken('token', 'missing-user'),
      );

      expect(outcome).toMatchObject({
        ok: false,
        error: { code: 'RESOURCE_NOT_FOUND', kind: 'not_found' },
      });
    });
  });
});
