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
  SerializeOptions,
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
  endSse,
  extractErrorInfo,
  prepareSse,
  SseProblemDetailsMapper,
  writeSseEvent,
  SseConnectionRegistry,
} from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { AssistantService } from './services/core.service.js';
import { AuditLogService } from '../audit-log/index.js';
import { assistantCapabilitiesDataSchema } from './dto/capabilities-response.dto.js';

import { assistantClearResultDataSchema } from './dto/stream-response.dto.js';

import { assistantClearMemoryDataSchema } from './dto/clear-memory-response.dto.js';

import { assistantConversationDataSchema } from './dto/conversation-response.dto.js';

import {
  assistantConversationListResponseSchema,
  assistantConversationSummarySchema,
} from './dto/conversation-list-response.dto.js';

import { streamAssistantMessagesSchema } from './dto/stream-messages.dto.js';
import type { StreamAssistantMessagesDto } from './dto/stream-messages.dto.js';

import { renameConversationSchema } from './dto/rename-conversation.dto.js';
import type { RenameConversationDto } from './dto/rename-conversation.dto.js';

import {
  AssistantConfirmResultResponseDto,
  confirmAssistantProposalSchema,
} from './dto/confirm-proposal.dto.js';
import type { ConfirmAssistantProposalDto } from './dto/confirm-proposal.dto.js';

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
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
  @ApiResponse({ status: 200, description: 'Assistant capabilities payload.' })
  @SerializeOptions({ schema: assistantCapabilitiesDataSchema })
  async getCapabilities(@CurrentUser() user: UserPayload) {
    return await this.assistantService.getCapabilities(user.sub);
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List recent persisted assistant conversations for the user',
  })
  // NOTE: JSON array body. Outbound validation uses the item schema (the
  // global serializer validates array items one by one); the OpenAPI
  // registration below uses the array schema (component keeps the former
  // class name — Luminous re-generation shape needs gate review).
  @ApiResponse({
    status: 200,
    description: 'List of recent assistant conversation summaries.',
  })
  @SerializeOptions({ schema: assistantConversationSummarySchema })
  async listRecentConversations(@CurrentUser() user: UserPayload) {
    return await this.assistantService.listRecentConversations(user.sub);
  }

  @Get('latest')
  @ApiOperation({
    summary:
      'Get the authenticated user latest persisted assistant conversation',
  })
  // NOTE: nullable body (resource or null). Registered with a `.nullable()`
  // component under the former `AssistantConversationDataDto` name; runtime
  // validation keeps the plain data schema (the serializer passes `null`
  // through untouched).
  @ApiResponse({
    status: 200,
    description:
      'Latest persisted assistant conversation, or null when none exists.',
  })
  @SerializeOptions({ schema: assistantConversationDataSchema })
  async getLatestConversation(@CurrentUser() user: UserPayload) {
    return await this.assistantService.getLatestConversation(user.sub);
  }

  @Post('conversations/:conversationId/open')
  @ApiOperation({
    summary:
      'Activate one persisted assistant conversation and return its full history',
  })
  @ApiResponse({
    status: 200,
    description: 'The activated conversation with its full message history.',
  })
  @SerializeOptions({ schema: assistantConversationDataSchema })
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
    @Body({ schema: confirmAssistantProposalSchema })
    dto: ConfirmAssistantProposalDto,
  ) {
    return unwrapResult(
      this.assistantService.confirmProposal(user.sub, conversationId, dto),
    );
  }

  @Patch('conversations/:conversationId')
  @ApiOperation({
    summary: 'Rename one persisted assistant conversation (title only)',
  })
  @ApiResponse({
    status: 200,
    description: 'The renamed conversation with its full message history.',
  })
  @SerializeOptions({ schema: assistantConversationDataSchema })
  async renameConversation(
    @CurrentUser() user: UserPayload,
    @Param('conversationId') conversationId: string,
    @Body({ schema: renameConversationSchema })
    dto: RenameConversationDto,
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
  @ApiResponse({
    status: 200,
    description:
      'The conversation after soft deletion (status archived/deleted).',
  })
  @SerializeOptions({ schema: assistantConversationDataSchema })
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
  @ApiResponse({
    status: 200,
    description: 'Number of persisted assistant memory rows deleted.',
  })
  @SerializeOptions({ schema: assistantClearMemoryDataSchema })
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
  @ApiResponse({
    status: 200,
    description:
      'Whether the latest conversation was cleared and the archived conversation id.',
  })
  @SerializeOptions({ schema: assistantClearResultDataSchema })
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
    @Body({ schema: streamAssistantMessagesSchema })
    dto: StreamAssistantMessagesDto,
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

registerResponseSchema({
  path: '/api/v1/user/assistant/capabilities',
  method: 'get',
  componentName: 'AssistantCapabilitiesResponseDto',
  schema: assistantCapabilitiesDataSchema,
  description: 'Assistant capabilities payload.',
});

// NOTE: array body — the component schema is the full response array; the
// endpoint handler validates per item with the item schema.
registerResponseSchema({
  path: '/api/v1/user/assistant/conversations',
  method: 'get',
  componentName: 'AssistantConversationSummaryDto',
  schema: assistantConversationListResponseSchema,
  description: 'List of recent assistant conversation summaries.',
});

// NOTE: nullable body — the component schema carries `.nullable()` so the
// 200 `$ref` keeps the “resource or null” semantics of the former inline
// nullable allOf document.
registerResponseSchema({
  path: '/api/v1/user/assistant/latest',
  method: 'get',
  componentName: 'AssistantConversationDataDto',
  schema: assistantConversationDataSchema.nullable(),
  description:
    'Latest persisted assistant conversation, or null when none exists.',
});

registerResponseSchema({
  path: '/api/v1/user/assistant/conversations/{conversationId}/open',
  method: 'post',
  componentName: 'AssistantConversationResponseDto',
  schema: assistantConversationDataSchema,
  description: 'The activated conversation with its full message history.',
});

registerResponseSchema({
  path: '/api/v1/user/assistant/conversations/{conversationId}',
  method: 'patch',
  componentName: 'AssistantConversationResponseDto',
  schema: assistantConversationDataSchema,
  description: 'The renamed conversation with its full message history.',
});

registerResponseSchema({
  path: '/api/v1/user/assistant/conversations/{conversationId}',
  method: 'delete',
  componentName: 'AssistantConversationResponseDto',
  schema: assistantConversationDataSchema,
  description:
    'The conversation after soft deletion (status archived/deleted).',
});

registerResponseSchema({
  path: '/api/v1/user/assistant/memory',
  method: 'delete',
  componentName: 'AssistantClearMemoryResponseDto',
  schema: assistantClearMemoryDataSchema,
  description: 'Number of persisted assistant memory rows deleted.',
});

registerResponseSchema({
  path: '/api/v1/user/assistant/latest/clear',
  method: 'post',
  componentName: 'AssistantClearResultResponseDto',
  schema: assistantClearResultDataSchema,
  description:
    'Whether the latest conversation was cleared and the archived conversation id.',
});
