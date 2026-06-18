import {
  Body,
  Controller,
  Get,
  HttpException,
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
import { type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiChatService } from './ai-chat.service';
import {
  AiChatCapabilitiesResponseDto,
  AiChatConversationResponseDto,
  AiChatStreamResultDto,
  StreamAiChatMessagesDto,
} from './dto';

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

  @Get('latest')
  @ApiOperation({
    summary: 'Get the authenticated user latest persisted AI chat conversation',
  })
  @ApiResponse({ status: 200, type: AiChatConversationResponseDto })
  async getLatestConversation(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.aiChatService.getLatestConversation(user.sub),
    );
  }

  @Post('latest/clear')
  @ApiOperation({
    summary:
      'Archive the authenticated user latest active AI chat conversation',
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
      await this.aiChatService.clearLatestConversation(user.sub),
    );
  }

  @Post('messages/stream')
  @SkipApiEnvelope()
  @ApiOperation({
    summary: 'Stream authenticated user AI chat assistant response',
  })
  @ApiResponse({ status: 200, type: AiChatStreamResultDto })
  async streamMessages(
    @CurrentUser() user: UserPayload,
    @Body() dto: StreamAiChatMessagesDto,
    @I18nLang() language: string,
    @Res() response: Response,
  ): Promise<void> {
    prepareSse(response);

    try {
      const result = await this.aiChatService.streamMessages(
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
