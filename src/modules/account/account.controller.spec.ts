/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'MOCK_SECRET'),
  generateURI: jest.fn(() => 'otpauth://'),
  verify: jest.fn(() => Promise.resolve({ valid: true })),
}));

import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import type { UserPayload } from '../auth/services/auth-token.service';

import { AccountController } from './account.controller';
import { AccountService } from './services/account.service';
import { AuthService } from '../auth/services/auth.service';
import type { UpdateAccountDto } from './dto/update-account.dto';
import type { AccountDto } from './dto/account-response.dto';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
};

const mockAccount: AccountDto = {
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
};

describe('AccountController', () => {
  let controller: AccountController;
  let accountService: jest.Mocked<AccountService>;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        {
          provide: AccountService,
          useValue: {
            getAccount: jest.fn(),
            updateAccount: jest.fn(),
            unlinkIdentity: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            changePassword: jest.fn(),
            setPassword: jest.fn(),
            changeEmail: jest.fn(),
            deleteAccount: jest.fn(),
            createWechatWebIdentityLinkAuthorizeUrl: jest.fn(),
            linkWechatWebIdentity: jest.fn(),
            linkWechatMobileIdentity: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AccountController);
    accountService = module.get(AccountService);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /account', () => {
    it('should return the account profile envelope', async () => {
      accountService.getAccount.mockResolvedValue(mockAccount);

      const result = await controller.getAccount(mockUser);

      expect(accountService.getAccount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockAccount,
      });
    });
  });

  describe('PATCH /account', () => {
    it('should update and return the account envelope', async () => {
      const dto: UpdateAccountDto = { nickname: 'UpdatedName' };
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      const updated: AccountDto = { ...mockAccount, nickname: 'UpdatedName' };
      accountService.updateAccount.mockResolvedValue(updated);

      const result = await controller.updateAccount(mockUser, dto);

      expect(accountService.updateAccount).toHaveBeenCalledWith(
        mockUser.sub,
        dto,
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: updated,
      });
    });
  });

  describe('POST /account/password', () => {
    it('should change password and return null data', async () => {
      authService.changePassword.mockResolvedValue(undefined);

      const result = await controller.changePassword(mockUser, {
        oldPassword: 'OldPass1',
        newPassword: 'NewPass1',
      });

      expect(authService.changePassword).toHaveBeenCalledWith(mockUser.sub, {
        oldPassword: 'OldPass1',
        newPassword: 'NewPass1',
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });
  });

  describe('POST /account/set-password', () => {
    it('should set initial password and return null data', async () => {
      authService.setPassword.mockResolvedValue(undefined);

      const result = await controller.setPassword(mockUser, {
        code: '123456',
        password: 'NewPass1',
      });

      expect(authService.setPassword).toHaveBeenCalledWith(mockUser.sub, {
        code: '123456',
        password: 'NewPass1',
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });
  });

  describe('POST /account/email', () => {
    it('should change email and return new email with verification time', async () => {
      const updatedUser = {
        email: 'new@example.com',
        emailVerifiedAt: new Date('2026-06-15T08:00:00.000Z'),
      };
      authService.changeEmail.mockResolvedValue(updatedUser as any);

      const result = await controller.changeEmail(mockUser, {
        newEmail: 'new@example.com',
        code: '123456',
      });

      expect(authService.changeEmail).toHaveBeenCalledWith(mockUser.sub, {
        newEmail: 'new@example.com',
        code: '123456',
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: {
          email: 'new@example.com',
          emailVerifiedAt: '2026-06-15T08:00:00.000Z',
        },
      });
    });

    it('should return null emailVerifiedAt when the value is null', async () => {
      authService.changeEmail.mockResolvedValue({
        email: 'unverified@example.com',
        emailVerifiedAt: null,
      } as any);

      const result = await controller.changeEmail(mockUser, {
        newEmail: 'unverified@example.com',
        code: '123456',
      });

      expect(result.data?.emailVerifiedAt).toBeNull();
    });
  });

  describe('DELETE /account/identities/:identityId', () => {
    it('should unlink identity and return the account envelope', async () => {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      const updated: AccountDto = { ...mockAccount, linkedIdentities: [] };
      accountService.unlinkIdentity.mockResolvedValue(updated);

      const result = await controller.unlinkIdentity(
        mockUser,
        'identity-uuid-1',
      );

      expect(accountService.unlinkIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        'identity-uuid-1',
      );
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: updated,
      });
    });
  });

  describe('POST /account/identities/wechat-web/authorize', () => {
    it('should return authorize URL envelope', async () => {
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
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: authorizeResult,
      });
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
    it('should link WeChat web identity and return account envelope', async () => {
      authService.linkWechatWebIdentity.mockResolvedValue(undefined);
      accountService.getAccount.mockResolvedValue(mockAccount);

      const result = await controller.linkWechatWebIdentity(mockUser, {
        code: 'auth-code',
        state: 'state-xxx',
      });

      expect(authService.linkWechatWebIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        { code: 'auth-code', state: 'state-xxx' },
      );
      expect(accountService.getAccount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockAccount,
      });
    });
  });

  describe('POST /account/identities/wechat-mobile/callback', () => {
    it('should link WeChat mobile identity and return account envelope', async () => {
      authService.linkWechatMobileIdentity.mockResolvedValue(undefined);
      accountService.getAccount.mockResolvedValue(mockAccount);

      const result = await controller.linkWechatMobileIdentity(mockUser, {
        code: 'mobile-auth-code',
      });

      expect(authService.linkWechatMobileIdentity).toHaveBeenCalledWith(
        mockUser.sub,
        { code: 'mobile-auth-code' },
      );
      expect(accountService.getAccount).toHaveBeenCalledWith(mockUser.sub);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: mockAccount,
      });
    });
  });

  describe('DELETE /account', () => {
    it('should delete account and return null data', async () => {
      authService.deleteAccount.mockResolvedValue(undefined);

      const result = await controller.deleteAccount(mockUser, {
        password: 'Passw0rd123',
      });

      expect(authService.deleteAccount).toHaveBeenCalledWith(mockUser.sub, {
        password: 'Passw0rd123',
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });
  });
});
