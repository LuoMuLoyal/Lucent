import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { successEnvelope } from '../common/api-envelope';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { UserPayload } from '../auth/auth.service';
import { HealthContextResponseDto } from './dto';
import { UserHealthContextService } from './user-health-context.service';

@ApiTags('User Health Context')
@Controller('me/health-context')
export class UserHealthContextController {
  constructor(
    private readonly userHealthContextService: UserHealthContextService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user health context aggregate' })
  @ApiResponse({ status: 200, type: HealthContextResponseDto })
  async getMeHealthContext(@CurrentUser() user: UserPayload) {
    const healthContext = await this.userHealthContextService.getForUser(
      user.sub,
    );

    return successEnvelope(healthContext);
  }
}
