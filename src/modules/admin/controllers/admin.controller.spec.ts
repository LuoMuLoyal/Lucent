import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CLASS_SERIALIZER_OPTIONS } from '@nestjs/common/serializer/class-serializer.constants.js';
import { z } from 'zod';
import { AdminRole } from '#generated/prisma/client.js';
import { responseSchemaRegistrations } from '../../../common/api/response-schema.registry.js';
import type { UserPayload } from '../../auth/index.js';
import type { AuthSessionAdminService } from '../../auth/index.js';
import type { UserAdminService } from '../../user/index.js';
import type { QaChunksAdminService } from '../../assistant/index.js';
import type { AdminAccessService } from '../services/access.service.js';
import type { AdminAdminsService } from '../services/admins.service.js';
import type { AdminConsoleService } from '../services/console.service.js';
import type { AdminSharesService } from '../services/shares.service.js';
import type { AdminUserRelatedService } from '../services/user-related.service.js';
import { AdminController } from './admin.controller.js';

const user: UserPayload = {
  sub: 'user-1',
  email: 'editor@example.com',
  status: 'active',
};

const identity = {
  id: 'user-1',
  email: 'editor@example.com',
  nickname: 'Editor',
  avatar: null,
  role: AdminRole.EDITOR,
  permissions: ['content:read', 'content:write'],
};

describe('AdminController', () => {
  it('returns the current role and permissions', async () => {
    const adminAccess = {
      getIdentity: vi.fn().mockResolvedValue(identity),
    } as unknown as AdminAccessService;
    const controller = new AdminController(
      adminAccess,
      {} as unknown as AdminConsoleService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.getMe(user)).resolves.toEqual(identity);
    expect(adminAccess.getIdentity).toHaveBeenCalledWith(user.sub);
  });

  it('fails closed if the admin role is revoked between guard and query', async () => {
    const adminAccess = {
      getIdentity: vi.fn().mockResolvedValue(null),
    } as unknown as AdminAccessService;
    const controller = new AdminController(
      adminAccess,
      {} as unknown as AdminConsoleService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.getMe(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // Regression guard for a live 500: StandardSchemaSerializerInterceptor
  // validates a JSON array body item by item using the `@SerializeOptions`
  // schema, so an array schema there fails every item. The array shape stays
  // documented through the response-schema registry instead
  // (scripts/contract/export-openapi.ts wires it to the 200 response).
  describe.each([
    {
      handlerName: 'listLegalDocuments' as const,
      path: '/api/v1/admin/content/legal-documents',
      componentName: 'AdminLegalDocumentList',
    },
    {
      handlerName: 'listSafetyTips' as const,
      path: '/api/v1/admin/content/safety-tips',
      componentName: 'AdminSafetyTipList',
    },
  ])('$handlerName', ({ handlerName, path, componentName }) => {
    function outboundSchema(): z.ZodType {
      const handler = AdminController.prototype[handlerName];
      const options = Reflect.getMetadata(CLASS_SERIALIZER_OPTIONS, handler) as
        | { schema?: z.ZodType }
        | undefined;
      expect(options?.schema).toBeDefined();
      return options!.schema!;
    }

    it('hands the serializer an item schema rather than an array schema', () => {
      const jsonSchema = z.toJSONSchema(outboundSchema()) as {
        type?: string;
      };

      expect(jsonSchema.type).not.toBe('array');
      expect(jsonSchema.type).toBe('object');
    });

    it('documents the array shape through the response schema registry', () => {
      const registration = responseSchemaRegistrations.find(
        (entry) => entry.path === path && entry.method === 'get',
      );

      expect(registration?.componentName).toBe(componentName);
      expect(
        (z.toJSONSchema(registration!.schema) as { type?: string }).type,
      ).toBe('array');
    });
  });

  describe('user lifecycle and role management', () => {
    function makeController(deps: {
      admins?: Partial<AdminAdminsService>;
      userAdmin?: Partial<UserAdminService>;
      authSessions?: Partial<AuthSessionAdminService>;
      shares?: Partial<AdminSharesService>;
      userRelated?: Partial<AdminUserRelatedService>;
      adminConsole?: Partial<AdminConsoleService>;
    }): AdminController {
      return new AdminController(
        {} as unknown as AdminAccessService,
        (deps.adminConsole ?? {}) as unknown as AdminConsoleService,
        (deps.admins ?? {}) as unknown as AdminAdminsService,
        (deps.userAdmin ?? {}) as unknown as UserAdminService,
        (deps.authSessions ?? {}) as unknown as AuthSessionAdminService,
        (deps.shares ?? {}) as unknown as AdminSharesService,
        (deps.userRelated ?? {}) as unknown as AdminUserRelatedService,
        {} as never,
        {} as never,
        {} as never,
      );
    }

    it("refuses to change the caller's own status", async () => {
      const controller = makeController({});

      await expect(
        controller.updateUserStatus(user, user.sub, { status: 'suspended' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to delete a super administrator', async () => {
      const controller = makeController({
        admins: { isSuperAdmin: vi.fn().mockResolvedValue(true) },
      });

      await expect(controller.deleteUser(user, 'other-user')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('revokes all sessions after suspending a user', async () => {
      const authSessions = {
        revokeAllForUser: vi.fn().mockResolvedValue(undefined),
      };
      const controller = makeController({
        admins: { isSuperAdmin: vi.fn().mockResolvedValue(false) },
        userAdmin: {
          setStatus: vi.fn().mockResolvedValue({
            userId: 'other-user',
            before: 'active',
            after: 'suspended',
          }),
        },
        authSessions,
        adminConsole: {
          getUser: vi.fn().mockResolvedValue({
            id: 'other-user',
            email: 'other@example.com',
            nickname: null,
            status: 'suspended',
            emailVerified: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastLoginAt: null,
            adminRole: null,
          }),
        },
      });

      await controller.updateUserStatus(user, 'other-user', {
        status: 'suspended',
      });

      expect(authSessions.revokeAllForUser).toHaveBeenCalledWith(
        user.sub,
        'other-user',
      );
    });

    it('does not revoke sessions when re-activating a user', async () => {
      const authSessions = { revokeAllForUser: vi.fn() };
      const controller = makeController({
        admins: { isSuperAdmin: vi.fn().mockResolvedValue(false) },
        userAdmin: {
          setStatus: vi.fn().mockResolvedValue({
            userId: 'other-user',
            before: 'suspended',
            after: 'active',
          }),
        },
        authSessions,
        adminConsole: {
          getUser: vi.fn().mockResolvedValue({
            id: 'other-user',
            email: 'other@example.com',
            nickname: null,
            status: 'active',
            emailVerified: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastLoginAt: null,
            adminRole: null,
          }),
        },
      });

      await controller.updateUserStatus(user, 'other-user', { status: 'active' });

      expect(authSessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('maps the last-super-admin refusal to 409', async () => {
      const controller = makeController({
        admins: {
          setRole: vi.fn().mockResolvedValue({ status: 'last_super_admin' }),
        },
      });

      await expect(
        controller.setAdminRole(user, 'other-user', { role: AdminRole.VIEWER }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("returns a user's related records", async () => {
      const related = { groups: [] };
      const controller = makeController({
        userRelated: { getForUser: vi.fn().mockResolvedValue(related) },
      });

      await expect(
        controller.getUserRelated('other-user', { limit: 10 }),
      ).resolves.toBe(related);
    });

    it('maps a missing user to 404', async () => {
      const controller = makeController({
        userRelated: { getForUser: vi.fn().mockResolvedValue(null) },
      });

      await expect(
        controller.getUserRelated('missing', { limit: 10 }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('QA corpus chunks', () => {
    function makeController(deps: {
      qaChunks?: Partial<QaChunksAdminService>;
    }): AdminController {
      return new AdminController(
        {} as unknown as AdminAccessService,
        {} as unknown as AdminConsoleService,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        (deps.qaChunks ?? {}) as unknown as QaChunksAdminService,
      );
    }

    it('pages through the corpus with the query defaults resolved', async () => {
      const page = { items: [], total: 0, page: 1, limit: 25 };
      const qaChunks = { list: vi.fn().mockResolvedValue(page) };
      const controller = makeController({ qaChunks });

      await expect(
        controller.listQaChunks({ page: 1, limit: 25 }),
      ).resolves.toBe(page);
      expect(qaChunks.list).toHaveBeenCalledWith({ page: 1, limit: 25 });
    });

    it('returns the updated chunk', async () => {
      const chunk = { id: 'chunk-1', safetyLabel: 'blocked' };
      const qaChunks = { update: vi.fn().mockResolvedValue(chunk) };
      const controller = makeController({ qaChunks });

      await expect(
        controller.updateQaChunk(user, 'chunk-1', { safetyLabel: 'blocked' }),
      ).resolves.toBe(chunk);
      expect(qaChunks.update).toHaveBeenCalledWith(user.sub, 'chunk-1', {
        safetyLabel: 'blocked',
      });
    });

    it('maps an unknown chunk to 404', async () => {
      const controller = makeController({
        qaChunks: { update: vi.fn().mockResolvedValue(null) },
      });

      await expect(
        controller.updateQaChunk(user, 'missing', { question: 'changed' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
