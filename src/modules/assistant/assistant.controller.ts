import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';
import {
  endSse,
  extractErrorInfo,
  prepareSse,
  SseProblemDetailsMapper,
  writeSseEvent,
  SseConnectionRegistry,
} from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { AssistantService } from './services/core.service.js';
import { AuditLogService } from '../audit-log/index.js';
import { AssistantCapabilitiesResponseDto } from './dto/capabilities-response.dto.js';

import { AssistantClearResultResponseDto } from './dto/stream-response.dto.js';

import { AssistantClearMemoryResponseDto } from './dto/clear-memory-response.dto.js';

import { AssistantConversationSummaryDto } from './dto/conversation-list-response.dto.js';

import {
  AssistantConversationDataDto,
  AssistantConversationResponseDto,
} from './dto/conversation-response.dto.js';

import { StreamAssistantMessagesDto } from './dto/stream-messages.dto.js';

import { RenameConversationDto } from './dto/rename-conversation.dto.js';

import {
  AssistantConfirmResultResponseDto,
  ConfirmAssistantProposalDto,
} from './dto/confirm-proposal.dto.js';

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
@ApiExtraModels(AssistantConversationDataDto)
@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly assistantService: AssistantService,
    private readonly sseRegistry: SseConnectionRegistry,
    private readonly sseProblemDetails: SseProblemDetailsMapper,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('capabilities')
  @ApiOperation({
    summary: 'Get authenticated user assistant capabilities and permissions',
  })
  @ApiResponse({ status: 200, type: AssistantCapabilitiesResponseDto })
  async getCapabilities(@CurrentUser() user: UserPayload) {
    return await this.assistantService.getCapabilities(user.sub);
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List recent persisted assistant conversations for the user',
  })
  @ApiResponse({ status: 200, type: [AssistantConversationSummaryDto] })
  async listRecentConversations(@CurrentUser() user: UserPayload) {
    return await this.assistantService.listRecentConversations(user.sub);
  }

  @Get('latest')
  @ApiOperation({
    summary:
      'Get the authenticated user latest persisted assistant conversation',
  })
  @ApiResponse({
    status: 200,
    schema: {
      nullable: true,
      allOf: [{ $ref: getSchemaPath(AssistantConversationDataDto) }],
    },
  })
  async getLatestConversation(@CurrentUser() user: UserPayload) {
    return await this.assistantService.getLatestConversation(user.sub);
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
    return unwrapResult(
      this.assistantService.openConversation(user.sub, conversationId),
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
    return unwrapResult(
      this.assistantService.confirmProposal(user.sub, conversationId, dto),
    );
  }

  @Patch('conversations/:conversationId')
  @ApiOperation({
    summary: 'Rename one persisted assistant conversation (title only)',
  })
  @ApiResponse({ status: 200, type: AssistantConversationResponseDto })
  async renameConversation(
    @CurrentUser() user: UserPayload,
    @Param('conversationId') conversationId: string,
    @Body() dto: RenameConversationDto,
  ) {
    return unwrapResult(
      this.assistantService.renameConversation(
        user.sub,
        conversationId,
        dto.title,
      ),
    );
  }

  @Delete('conversations/:conversationId')
  @ApiOperation({
    summary: 'Soft-delete one persisted assistant conversation',
  })
  @ApiResponse({ status: 200, type: AssistantConversationResponseDto })
  async deleteConversation(
    @CurrentUser() user: UserPayload,
    @Param('conversationId') conversationId: string,
  ) {
    return unwrapResult(
      this.assistantService.deleteConversation(user.sub, conversationId),
    );
  }

  @Delete('memory')
  @ApiOperation({
    summary: 'Erase all persisted assistant memories for the user',
  })
  @ApiResponse({ status: 200, type: AssistantClearMemoryResponseDto })
  async clearMemory(@CurrentUser() user: UserPayload) {
    const result = await this.assistantService.clearAssistantMemory(user.sub);
    this.auditLogService.logFireAndForget({
      userId: user.sub,
      action: 'assistant.memory.clear',
      metadata: { deletedCount: result.cleared },
    });
    return result;
  }

  @Post('latest/clear')
  @ApiOperation({
    summary:
      'Archive the authenticated user latest active assistant conversation',
  })
  @ApiResponse({ status: 200, type: AssistantClearResultResponseDto })
  async clearLatestConversation(@CurrentUser() user: UserPayload) {
    return await this.assistantService.clearLatestConversation(user.sub);
  }

  @SkipThrottle()
  @Post('messages/stream')
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
    prepareSse(reply.raw, this.sseRegistry, language);

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

      result.match(
        (value) => {
          writeSseEvent(reply.raw, {
            event: 'result',
            data: value,
          });
          writeSseEvent(reply.raw, {
            event: 'done',
            data: {},
          });
        },
        (failure) => {
          writeSseEvent(reply.raw, {
            event: 'error',
            data: this.sseProblemDetails.build(failure, { lang: language }),
          });
        },
      );
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Assistant stream failed for user ${user.sub}: ${reason}`,
        stack,
      );
      writeSseEvent(reply.raw, {
        event: 'error',
        data: this.sseProblemDetails.build(error, { lang: language }),
      });
    } finally {
      endSse(reply.raw, this.sseRegistry);
    }
  }
  @SkipThrottle()
  @Post('conversations/:conversationId/regenerate')
  @ApiOperation({
    summary:
      'Regenerate the last assistant message of a persisted conversation (SSE)',
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
  async regenerateLastMessage(
    @CurrentUser() user: UserPayload,
    @Param('conversationId') conversationId: string,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    prepareSse(reply.raw, this.sseRegistry, language);

    try {
      const result = await this.assistantService.regenerateConversation(
        user.sub,
        conversationId,
        ({ content }) => {
          writeSseEvent(reply.raw, {
            event: 'chunk',
            data: { content },
          });
        },
      );

      result.match(
        (value) => {
          writeSseEvent(reply.raw, {
            event: 'result',
            data: value,
          });
          writeSseEvent(reply.raw, {
            event: 'done',
            data: {},
          });
        },
        (failure) => {
          writeSseEvent(reply.raw, {
            event: 'error',
            data: this.sseProblemDetails.build(failure, { lang: language }),
          });
        },
      );
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        `Assistant regenerate failed for user ${user.sub} conversation ${conversationId}: ${reason}`,
        stack,
      );
      writeSseEvent(reply.raw, {
        event: 'error',
        data: this.sseProblemDetails.build(error, { lang: language }),
      });
    } finally {
      endSse(reply.raw, this.sseRegistry);
    }
  }
}
