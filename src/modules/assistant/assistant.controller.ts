import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { I18nLang } from 'nestjs-i18n';
import { successEnvelope } from '../../common/api-envelope';
import { SkipApiEnvelope } from '../../common/interceptors/skip-api-envelope.decorator';
import { endSse, prepareSse, writeSseEvent } from '../../common/sse';
import { type UserPayload } from '../auth/types/auth-request';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssistantService } from './services/assistant.service';
import {
  AssistantCapabilitiesResponseDto,
  AssistantConversationListResponseDto,
  AssistantConversationResponseDto,
  AssistantStreamResultDto,
  StreamAssistantMessagesDto,
} from './dto';

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistantService: AssistantService) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Get authenticated user assistant capabilities and permissions',
  })
  @ApiResponse({ status: 200, type: AssistantCapabilitiesResponseDto })
  async getCapabilities(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.assistantService.getCapabilities(user.sub),
    );
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List recent persisted assistant conversations for the user',
  })
  @ApiResponse({ status: 200, type: AssistantConversationListResponseDto })
  async listRecentConversations(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.assistantService.listRecentConversations(user.sub),
    );
  }

  @Get('latest')
  @ApiOperation({
    summary:
      'Get the authenticated user latest persisted assistant conversation',
  })
  @ApiResponse({ status: 200, type: AssistantConversationResponseDto })
  async getLatestConversation(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.assistantService.getLatestConversation(user.sub),
    );
  }

  @Post('conversations/:conversationId/open')
  @ApiOperation({
    summary:
      'Activate one persisted assistant conversation and return its full history',
  })
  @ApiResponse({ status: 200, type: AssistantConversationResponseDto })
  async openConversation(
    @CurrentUser() user: UserPayload,
    @Param('conversationId') conversationId: string,
  ) {
    return successEnvelope(
      await this.assistantService.openConversation(user.sub, conversationId),
    );
  }

  @Post('latest/clear')
  @ApiOperation({
    summary:
      'Archive the authenticated user latest active assistant conversation',
  })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        code: { type: 'number', example: 0 },
        message: { type: 'string', example: '' },
        data: {
          type: 'object',
          properties: {
            cleared: { type: 'boolean', example: true },
            archivedConversationId: {
              type: 'string',
              nullable: true,
              example: 'conversation-id',
            },
          },
        },
      },
    },
  })
  async clearLatestConversation(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.assistantService.clearLatestConversation(user.sub),
    );
  }

  @Post('messages/stream')
  @SkipApiEnvelope()
  @ApiOperation({
    summary: 'Stream authenticated user assistant response',
  })
  @ApiResponse({ status: 200, type: AssistantStreamResultDto })
  async streamMessages(
    @CurrentUser() user: UserPayload,
    @Body() dto: StreamAssistantMessagesDto,
    @I18nLang() language: string,
    @Res() response: Response,
  ): Promise<void> {
    prepareSse(response);

    try {
      const result = await this.assistantService.streamMessages(
        user.sub,
        dto,
        language,
        ({ content }) => {
          writeSseEvent(response, {
            event: 'chunk',
            data: { content },
          });
        },
      );

      writeSseEvent(response, {
        event: 'result',
        data: result,
      });
      writeSseEvent(response, {
        event: 'done',
        data: {},
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Assistant stream failed for user ${user.sub}: ${reason}`,
        error instanceof Error ? error.stack : undefined,
      );
      writeSseEvent(response, {
        event: 'error',
        data: httpExceptionPayload(error),
      });
    } finally {
      endSse(response);
    }
  }
}

function httpExceptionPayload(error: unknown): {
  message: string;
  code?: number;
  statusCode?: number;
} {
  if (!(error instanceof HttpException)) {
    return {
      message: error instanceof Error ? error.message : 'Unexpected error.',
    };
  }

  const response = error.getResponse();
  if (typeof response === 'string') {
    return withOptionalErrorFields(response, undefined, error.getStatus());
  }

  const message =
    'message' in response
      ? (response as { message?: unknown }).message
      : undefined;
  const code =
    'code' in response ? (response as { code?: unknown }).code : undefined;
  if (Array.isArray(message)) {
    return withOptionalErrorFields(
      message.join('; '),
      typeof code === 'number' ? code : undefined,
      error.getStatus(),
    );
  }
  if (typeof message === 'string' && message.trim().length > 0) {
    return withOptionalErrorFields(
      message,
      typeof code === 'number' ? code : undefined,
      error.getStatus(),
    );
  }
  return withOptionalErrorFields(
    error.message,
    typeof code === 'number' ? code : undefined,
    error.getStatus(),
  );
}

function withOptionalErrorFields(
  message: string,
  code?: number,
  statusCode?: number,
): { message: string; code?: number; statusCode?: number } {
  const payload: { message: string; code?: number; statusCode?: number } = {
    message,
  };
  if (code != null) {
    payload.code = code;
  }
  if (statusCode != null) {
    payload.statusCode = statusCode;
  }
  return payload;
}
