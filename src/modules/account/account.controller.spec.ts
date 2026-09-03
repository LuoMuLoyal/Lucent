vi.mock('otplib', () => ({
  generateSecret: vi.fn(() => 'MOCK_SECRET'),
  generateURI: vi.fn(() => 'otpauth://'),
  verify: vi.fn(() => Promise.resolve({ valid: true })),
}));

import { Test, type TestingModule } from '@nestjs/testing';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';

import { AccountController } from './account.controller.js';
import { AccountService } from './services/account.service.js';
import { AuthService } from '../auth/index.js';
import { AuditLogService } from '../audit-log/index.js';
import type { UpdateAccountDto } from './dto/update.dto.js';
import type { AccountDto } from './dto/response.dto.js';
import type { User } from '#generated/prisma/client.js';

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
      accountService.getAccount.mockReturnValue(okAsync(mockAccount));

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
      accountService.updateAccount.mockReturnValue(okAsync(updated));

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
      authService.changePassword.mockReturnValue(okAsync(undefined));

      await expect(
        controller.changePassword(
          mockUser,
          {
            password: 'OldPass1',
            newPassword: 'NewPass1',
          },
          mockRequest,
        ),
      ).resolves.toBeUndefined();

      expect(authService.changePassword).toHaveBeenCalledWith(mockUser.sub, {
        password: 'OldPass1',
        newPassword: 'NewPass1',
      });
    });

    it('should fold wrong-password failures into DomainFailureException', async () => {
      authService.changePassword.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      await expect(
        controller.changePassword(
          mockUser,
          {
            password: 'WrongOld',
            newPassword: 'NewPass1',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_WRONG_PASSWORD' },
      });
    });

    it('should fold AUTH_PASSWORD_NOT_SET failures into DomainFailureException', async () => {
      authService.changePassword.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_PASSWORD_NOT_SET',
          }),
        ),
      );

      await expect(
        controller.changePassword(
          mockUser,
          {
            password: 'AnyPass1',
            newPassword: 'NewPass1',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_PASSWORD_NOT_SET' },
      });
    });
  });

  describe('POST /account/set-password', () => {
    it('should set initial password and return no content', async () => {
      authService.setPassword.mockReturnValue(okAsync(undefined));

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
      authService.changeEmail.mockReturnValue(
        okAsync(updatedUser as unknown as User),
      );

      const result = await controller.changeEmail(
        mockUser,
        {
          newEmail: 'new@example.com',
          code: '123456',
          password: 'Passw0rd123',
        },
        mockRequest,
      );

      expect(authService.changeEmail).toHaveBeenCalledWith(mockUser.sub, {
        newEmail: 'new@example.com',
        code: '123456',
        password: 'Passw0rd123',
      });
      expect(result).toEqual({
        email: 'new@example.com',
        emailVerifiedAt: '2026-06-15T08:00:00.000Z',
      });
    });

    it('should return null emailVerifiedAt when the value is null', async () => {
      authService.changeEmail.mockReturnValue(
        okAsync({
          email: 'unverified@example.com',
          emailVerifiedAt: null,
        } as unknown as User),
      );

      const result = await controller.changeEmail(
        mockUser,
        {
          newEmail: 'unverified@example.com',
          code: '123456',
          password: 'Passw0rd123',
        },
        mockRequest,
      );

      expect(result.emailVerifiedAt).toBeNull();
    });

    it('should fold email-conflict failures into DomainFailureException', async () => {
      authService.changeEmail.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'conflict',
            code: 'RESOURCE_CONFLICT',
          }),
        ),
      );

      await expect(
        controller.changeEmail(
          mockUser,
          {
            newEmail: 'taken@example.com',
            code: '123456',
            password: 'Passw0rd123',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'RESOURCE_CONFLICT' },
      });
    });
  });

  describe('DELETE /account/identities/:identityId', () => {
    it('should unlink identity and return the account resource', async () => {
      const updated: AccountDto = {
        ...mockAccount,
        linkedIdentities: [] as const,
      };
      accountService.unlinkIdentity.mockReturnValue(okAsync(updated));

      const result = await controller.unlinkIdentity(
        mockUser,
        'identity-uuid-1',
        { password: 'Passw0rd123' },
        mockRequest,
      );

      expect(accountService.unlinkIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        'identity-uuid-1',
        { password: 'Passw0rd123' },
      );
      expect(result).toEqual(updated);
    });

    it('should fold password re-auth failures into DomainFailureException', async () => {
      accountService.unlinkIdentity.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      await expect(
        controller.unlinkIdentity(
          mockUser,
          'identity-uuid-1',
          { password: 'WrongPass1' },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_WRONG_PASSWORD' },
      });
    });
  });

  describe('POST /account/identities/wechat-web/authorize', () => {
    it('should return the authorize URL resource', async () => {
      const authorizeResult = {
        authorizeUrl: 'https://open.weixin.qq.com/connect/qrconnect?…',
        state: 'state-xxx',
        expiresIn: 300,
      };
      authService.createWechatWebIdentityLinkAuthorizeUrl.mockReturnValue(
        okAsync(authorizeResult),
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
      authService.createWechatWebIdentityLinkAuthorizeUrl.mockReturnValue(
        okAsync(authorizeResult),
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
      authService.linkWechatWebIdentity.mockReturnValue(okAsync(undefined));
      accountService.getAccount.mockReturnValue(okAsync(mockAccount));

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
      authService.linkWechatMobileIdentity.mockReturnValue(okAsync(undefined));
      accountService.getAccount.mockReturnValue(okAsync(mockAccount));

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
      authService.deleteAccount.mockReturnValue(okAsync(undefined));

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

    it('should fold wrong-password failures into DomainFailureException', async () => {
      authService.deleteAccount.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_WRONG_PASSWORD',
          }),
        ),
      );

      await expect(
        controller.deleteAccount(
          mockUser,
          {
            password: 'WrongPass1',
          },
          mockRequest,
        ),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'AUTH_WRONG_PASSWORD' },
      });
    });
  });
});
