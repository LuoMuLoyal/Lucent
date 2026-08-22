vi.mock('otplib', () => ({
  generateSecret: vi.fn(() => 'MOCK_SECRET'),
  generateURI: vi.fn(() => 'otpauth://'),
  verify: vi.fn(() => Promise.resolve({ valid: true })),
}));

import { Test, type TestingModule } from '@nestjs/testing';
import type { UserPayload } from '../auth';

import { AccountController } from './account.controller';
import { AccountService } from './services/account.service';
import { AuthService } from '../auth';
import { AuditLogService } from '../audit-log';
import { SecurityElevationGuard } from '../security-pin';
import { SecurityPinService } from '../security-pin';
import type { UpdateAccountDto } from './dto/update.dto';
import type { AccountDto } from './dto/response.dto';
import type { User } from '#generated/prisma/client';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
};

const mockRequest = {
  ip: '10.0.0.1',
  headers: { 'user-agent': 'Luminous/1.0' },
  raw: { socket: { remoteAddress: '10.0.0.1' } },
} as never;

const mockAccount = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  nickname: 'TestUser',
  avatar: 'https://example.com/avatar.png',
  emailVerifiedAt: '2026-01-15T10:30:00.000Z',
  hasPassword: true,
  lastLoginAt: '2026-06-10T08:00:00.000Z',
  linkedIdentities: [
    {
      id: 'identity-uuid-1',
      provider: 'wechat_web',
      email: 'wechat-bound@example.com',
      emailVerifiedAt: '2026-01-15T10:30:00.000Z',
      linkedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-10T12:00:00.000Z',
} satisfies AccountDto;

describe('AccountController', () => {
  let controller: AccountController;
  let accountService: vi.Mocked<AccountService>;
  let authService: vi.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: {
            getAccount: vi.fn(),
            updateAccount: vi.fn(),
            unlinkIdentity: vi.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            changePassword: vi.fn(),
            setPassword: vi.fn(),
            changeEmail: vi.fn(),
            deleteAccount: vi.fn(),
            createWechatWebIdentityLinkAuthorizeUrl: vi.fn(),
            linkWechatWebIdentity: vi.fn(),
            linkWechatMobileIdentity: vi.fn(),
          },
        },
        SecurityElevationGuard,
        {
          provide: SecurityPinService,
          useValue: {
            verifyElevationToken: vi.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: vi.fn(),
            logFireAndForget: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AccountController);
    accountService = module.get(AccountService);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /account', () => {
    it('should return the account profile resource', async () => {
      accountService.getAccount.mockResolvedValue(mockAccount);

      const result = await controller.getAccount(mockUser);

      expect(accountService.getAccount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual(mockAccount);
    });
  });

  describe('PATCH /account', () => {
    it('should update and return the account resource', async () => {
      const dto: UpdateAccountDto = { nickname: 'UpdatedName' };
      const updated: AccountDto = {
        ...mockAccount,
        nickname: 'UpdatedName' as const,
      };
      accountService.updateAccount.mockResolvedValue(updated);

      const result = await controller.updateAccount(mockUser, dto);

      expect(accountService.updateAccount).toHaveBeenCalledWith(
        mockUser.sub,
        dto,
      );
      expect(result).toEqual(updated);
    });
  });

  describe('POST /account/password', () => {
    it('should change password and return no content', async () => {
      authService.changePassword.mockResolvedValue(undefined);

      await expect(
        controller.changePassword(
          mockUser,
          {
            oldPassword: 'OldPass1',
            newPassword: 'NewPass1',
          },
          mockRequest,
        ),
      ).resolves.toBeUndefined();

      expect(authService.changePassword).toHaveBeenCalledWith(mockUser.sub, {
        oldPassword: 'OldPass1',
        newPassword: 'NewPass1',
      });
    });
  });

  describe('POST /account/set-password', () => {
    it('should set initial password and return no content', async () => {
      authService.setPassword.mockResolvedValue(undefined);

      await expect(
        controller.setPassword(
          mockUser,
          {
            code: '123456',
            password: 'NewPass1',
          },
          mockRequest,
        ),
      ).resolves.toBeUndefined();

      expect(authService.setPassword).toHaveBeenCalledWith(mockUser.sub, {
        code: '123456',
        password: 'NewPass1',
      });
    });
  });

  describe('POST /account/email', () => {
    it('should change email and return new email with verification time', async () => {
      const updatedUser = {
        email: 'new@example.com',
        emailVerifiedAt: new Date('2026-06-15T08:00:00.000Z'),
      };
      authService.changeEmail.mockResolvedValue(updatedUser as unknown as User);

      const result = await controller.changeEmail(
        mockUser,
        {
          newEmail: 'new@example.com',
          code: '123456',
        },
        mockRequest,
      );

      expect(authService.changeEmail).toHaveBeenCalledWith(mockUser.sub, {
        newEmail: 'new@example.com',
        code: '123456',
      });
      expect(result).toEqual({
        email: 'new@example.com',
        emailVerifiedAt: '2026-06-15T08:00:00.000Z',
      });
    });

    it('should return null emailVerifiedAt when the value is null', async () => {
      authService.changeEmail.mockResolvedValue({
        email: 'unverified@example.com',
        emailVerifiedAt: null,
      } as unknown as User);

      const result = await controller.changeEmail(
        mockUser,
        {
          newEmail: 'unverified@example.com',
          code: '123456',
        },
        mockRequest,
      );

      expect(result.emailVerifiedAt).toBeNull();
    });
  });

  describe('DELETE /account/identities/:identityId', () => {
    it('should unlink identity and return the account resource', async () => {
      const updated: AccountDto = {
        ...mockAccount,
        linkedIdentities: [] as const,
      };
      accountService.unlinkIdentity.mockResolvedValue(updated);

      const result = await controller.unlinkIdentity(
        mockUser,
        'identity-uuid-1',
        mockRequest,
      );

      expect(accountService.unlinkIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        'identity-uuid-1',
      );
      expect(result).toEqual(updated);
    });
  });

  describe('POST /account/identities/wechat-web/authorize', () => {
    it('should return the authorize URL resource', async () => {
      const authorizeResult = {
        authorizeUrl: 'https://open.weixin.qq.com/connect/qrconnect?…',
        state: 'state-xxx',
        expiresIn: 300,
      };
      authService.createWechatWebIdentityLinkAuthorizeUrl.mockResolvedValue(
        authorizeResult,
      );

      const result = await controller.createWechatWebIdentityLinkAuthorizeUrl();

      expect(
        authService.createWechatWebIdentityLinkAuthorizeUrl,
      ).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(authorizeResult);
    });

    it('should pass callbackUri when provided', async () => {
      const authorizeResult = {
        authorizeUrl: 'https://open.weixin.qq.com/connect/qrconnect?…',
        state: 'state-yyy',
        expiresIn: 300,
      };
      authService.createWechatWebIdentityLinkAuthorizeUrl.mockResolvedValue(
        authorizeResult,
      );

      await controller.createWechatWebIdentityLinkAuthorizeUrl({
        callbackUri: 'http://127.0.0.1:49152/oauth/wechat',
      });

      expect(
        authService.createWechatWebIdentityLinkAuthorizeUrl,
      ).toHaveBeenCalledWith({
        callbackUri: 'http://127.0.0.1:49152/oauth/wechat',
      });
    });
  });

  describe('POST /account/identities/wechat-web/callback', () => {
    it('should link WeChat web identity and return the account resource', async () => {
      authService.linkWechatWebIdentity.mockResolvedValue(undefined);
      accountService.getAccount.mockResolvedValue(mockAccount);

      const result = await controller.linkWechatWebIdentity(
        mockUser,
        {
          code: 'auth-code',
          state: 'state-xxx',
        },
        mockRequest,
      );

      expect(authService.linkWechatWebIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        { code: 'auth-code', state: 'state-xxx' },
      );
      expect(accountService.getAccount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual(mockAccount);
    });
  });

  describe('POST /account/identities/wechat-mobile/callback', () => {
    it('should link WeChat mobile identity and return the account resource', async () => {
      authService.linkWechatMobileIdentity.mockResolvedValue(undefined);
      accountService.getAccount.mockResolvedValue(mockAccount);

      const result = await controller.linkWechatMobileIdentity(
        mockUser,
        {
          code: 'mobile-auth-code',
        },
        mockRequest,
      );

      expect(authService.linkWechatMobileIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        { code: 'mobile-auth-code' },
      );
      expect(accountService.getAccount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual(mockAccount);
    });
  });

  describe('DELETE /account', () => {
    it('should delete account and return no content', async () => {
      authService.deleteAccount.mockResolvedValue(undefined);

      await expect(
        controller.deleteAccount(
          mockUser,
          {
            password: 'Passw0rd123',
          },
          mockRequest,
        ),
      ).resolves.toBeUndefined();

      expect(authService.deleteAccount).toHaveBeenCalledWith(mockUser.sub, {
        password: 'Passw0rd123',
      });
    });
  });
});
