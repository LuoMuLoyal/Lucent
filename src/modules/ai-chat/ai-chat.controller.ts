import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common/api-envelope';
import { type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiChatService } from './ai-chat.service';
import { AiChatCapabilitiesResponseDto } from './dto';

@ApiTags('AI Chat')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('user/ai-chat')
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Get authenticated user AI chat capabilities and permissions',
  })
  @ApiResponse({ status: 200, type: AiChatCapabilitiesResponseDto })
  async getCapabilities(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.aiChatService.getCapabilities(user.sub));
  }
}
