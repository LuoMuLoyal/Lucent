import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { ConfigKey } from '../../../config/config-keys.enum';
import type { UserPayload } from '../types/auth-request';
import { JwtAccessStrategy } from './jwt-access.strategy';

describe('JwtAccessStrategy', () => {
  const jwtConfig = {
    accessSecret: 'test-access-secret',
    accessTtl: 900,
    refreshSecret: 'test-refresh-secret',
    refreshTtl: 604800,
    issuer: 'lucent-test',
    audience: 'luminous-test',
  };

  let configService: {
    getOrThrow: jest.Mock;
  };

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === (ConfigKey.Jwt as string)) {
          return jwtConfig;
        }
        throw new Error(`unexpected config key: ${key}`);
      }),
    };
  });

  describe('constructor', () => {
    it('initializes with the correct JWT config from ConfigService', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );

      expect(strategy).toBeDefined();
      expect(configService.getOrThrow).toHaveBeenCalledWith(ConfigKey.Jwt);
    });

    it('throws when ConfigService does not have JWT config', () => {
      configService.getOrThrow.mockImplementation(() => {
        throw new Error('Config not found');
      });

      expect(
        () => new JwtAccessStrategy(configService as unknown as ConfigService),
      ).toThrow('Config not found');
    });
  });

  describe('validate', () => {
    it('returns the payload for an active user', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        status: 'active',
      };

      const result = strategy.validate(payload);

      expect(result).toEqual(payload);
    });

    it('returns the payload for a token without status field (backward compatibility)', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = { sub: 'user-1', email: 'test@example.com' };

      const result = strategy.validate(payload);

      expect(result).toEqual(payload);
    });

    it('returns the payload when status is undefined', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload: UserPayload = {
        sub: 'user-1',
        email: 'test@example.com',
      };

      const result = strategy.validate(payload);

      expect(result).toEqual(payload);
    });

    it('returns the payload when status is null', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        status: null,
      } as unknown as UserPayload;

      const result = strategy.validate(payload);

      expect(result).toEqual(payload);
    });

    it('throws UnauthorizedException when sub is missing', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = { sub: '', email: 'test@example.com' };

      expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when sub is undefined', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = {
        sub: undefined as unknown as string,
        email: 'test@example.com',
      };

      expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a suspended user', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        status: 'suspended',
      };

      expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a deleted user', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        status: 'deleted',
      };

      expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for any non-active status', () => {
      const strategy = new JwtAccessStrategy(
        configService as unknown as ConfigService,
      );
      const payload = {
        sub: 'user-1',
        email: 'test@example.com',
        status: 'banned',
      };

      expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
    });
  });
});
