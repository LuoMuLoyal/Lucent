import { ForbiddenException } from '@nestjs/common';
import { CLASS_SERIALIZER_OPTIONS } from '@nestjs/common/serializer/class-serializer.constants.js';
import { z } from 'zod';
import { AdminRole } from '#generated/prisma/client.js';
import { responseSchemaRegistrations } from '../../../common/api/response-schema.registry.js';
import type { UserPayload } from '../../auth/index.js';
import type { AdminAccessService } from '../services/access.service.js';
import type { AdminConsoleService } from '../services/console.service.js';
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
});
