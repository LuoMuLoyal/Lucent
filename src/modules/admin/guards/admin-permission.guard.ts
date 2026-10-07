import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserPayload } from '../../auth/index.js';
import { REQUIRED_ADMIN_PERMISSION } from '../decorators/require-permission.decorator.js';
import { AdminAccessService } from '../services/access.service.js';
import type { AdminPermission } from '../constants/permissions.js';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminAccess: AdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: UserPayload }>();
    const user = request.user;
    if (user == null) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Admin access requires an authenticated user',
      });
    }

    const role = await this.adminAccess.getRole(user.sub);
    if (role == null) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }

    const permission = this.reflector.getAllAndOverride<AdminPermission>(
      REQUIRED_ADMIN_PERMISSION,
      [context.getHandler(), context.getClass()],
    ) as AdminPermission | undefined;
    if (permission === undefined || !this.adminAccess.can(role, permission)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSION',
        message: 'Admin permission required',
      });
    }

    return true;
  }
}
