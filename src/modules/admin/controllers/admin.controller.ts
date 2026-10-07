import {
  Controller,
  ForbiddenException,
  Get,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/index.js';
import type { UserPayload } from '../../auth/index.js';
import {
  ProblemDetailsDto,
  registerResponseSchema,
} from '../../../common/index.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { AdminAccessService } from '../services/access.service.js';
import { adminIdentityResponseSchema } from '../dto/admin-identity.dto.js';
import type { AdminIdentityDto } from '../dto/admin-identity.dto.js';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminAccess: AdminAccessService) {}

  @Get('me')
  @SerializeOptions({ schema: adminIdentityResponseSchema })
  @ApiOperation({ summary: 'Get the current administrator identity and permissions' })
  @ApiResponse({ status: 200, description: 'Current administrator identity.' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not have an AdminUser role.',
    type: ProblemDetailsDto,
  })
  async getMe(@CurrentUser() user: UserPayload): Promise<AdminIdentityDto> {
    const identity = await this.adminAccess.getIdentity(user.sub);
    if (identity === null) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return identity;
  }
}

registerResponseSchema({
  path: '/api/v1/admin/me',
  method: 'get',
  componentName: 'AdminIdentity',
  schema: adminIdentityResponseSchema,
  description: 'Current administrator identity and permissions.',
});
