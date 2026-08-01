import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';
import {
  successEnvelope,
  endSse,
  prepareSse,
  writeSseEvent,
  SseConnectionRegistry,
} from '../../common';
import { SkipApiEnvelope } from '../../common';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { AssistantService } from './services/core.service';
import { AssistantCapabilitiesResponseDto } from './dto/capabilities-response.dto';

import { AssistantClearResultResponseDto } from './dto/stream-response.dto';

import { AssistantConversationListResponseDto } from './dto/conversation-list-response.dto';

import { AssistantConversationResponseDto } from './dto/conversation-response.dto';

import { StreamAssistantMessagesDto } from './dto/stream-messages.dto';

import {
  AssistantConfirmResultResponseDto,
  ConfirmAssistantProposalDto,
} from './dto/confirm-proposal.dto';

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly assistantService: AssistantService,
    private readonly sseRegistry: SseConnectionRegistry,
  ) {}

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

  @Post('conversations/:conversationId/confirm')
  @ApiOperation({
    summary:
      'Confirm or reject pending assistant write proposals and resume the graph thread',
  })
  @ApiResponse({ status: 200, type: AssistantConfirmResultResponseDto })
  async confirmProposal(
    @CurrentUser() user: UserPayload,
    @Param('conversationId') conversationId: string,
    @Body() dto: ConfirmAssistantProposalDto,
  ) {
    return successEnvelope(
      await this.assistantService.confirmProposal(
        user.sub,
        conversationId,
        dto,
      ),
    );
  }

  @Post('latest/clear')
  @ApiOperation({
    summary:
      'Archive the authenticated user latest active assistant conversation',
  })
  @ApiResponse({ status: 200, type: AssistantClearResultResponseDto })
  async clearLatestConversation(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.assistantService.clearLatestConversation(user.sub),
    );
  }

  @SkipThrottle()
  @Post('messages/stream')
  @SkipApiEnvelope()
  @ApiOperation({
    summary: 'Stream authenticated user assistant response',
  })
  @ApiResponse({
    status: 200,
    description:
      'Server-Sent Events stream. Each event has an "event" field (chunk | result | error | done) and a JSON "data" field.',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
    },
  })
  async streamMessages(
    @CurrentUser() user: UserPayload,
    @Body() dto: StreamAssistantMessagesDto,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    prepareSse(reply.raw, this.sseRegistry);

    try {
      const result = await this.assistantService.streamMessages(
        user.sub,
        dto,
        language,
        ({ content }) => {
          writeSseEvent(reply.raw, {
            event: 'chunk',
            data: { content },
          });
        },
      );

      writeSseEvent(reply.raw, {
        event: 'result',
        data: result,
      });
      writeSseEvent(reply.raw, {
        event: 'done',
        data: {},
      });
    } catch (error) {
      const payload = this.resolveErrorPayload(error);
      this.logger.error(
        `Assistant stream failed for user ${user.sub}: ${payload.logMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      writeSseEvent(reply.raw, {
        event: 'error',
        data: { message: payload.clientMessage },
      });
    } finally {
      endSse(reply.raw, this.sseRegistry);
    }
  }
  private resolveErrorPayload(error: unknown): {
    clientMessage: string;
    logMessage: string;
  } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string' ? response : extractMessage(response);
      return {
        clientMessage: message,
        logMessage: message,
      };
    }

    const internal =
      error instanceof Error ? error.message : 'Unexpected error.';
    return {
      clientMessage: 'An unexpected error occurred. Please try again.',
      logMessage: internal,
    };
  }
}

function extractMessage(response: object): string {
  if ('message' in response) {
    const value = (response as { message?: unknown }).message;
    if (Array.isArray(value)) {
      return value.join('; ');
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return 'Request failed.';
}
