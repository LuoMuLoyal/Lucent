import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { UserPayload } from '../../auth/index.js';
import { AdminAccessService } from '../services/access.service.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminAccess: AdminAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: UserPayload }>();
    const user = request.user;
    if (user == null) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Admin access requires an authenticated user',
      });
    }

    if ((await this.adminAccess.getRole(user.sub)) == null) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }

    return true;
  }
}
