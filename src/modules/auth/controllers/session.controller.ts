import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import {
  calculateExpiresIn,
  extractAuthRequestContext,
  ProblemDetailsDto,
} from '../../../common/index.js';
import { registerResponseSchema } from '../../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../../common/result/index.js';
import { AuditLogService } from '../../audit-log/index.js';
import { AuthService } from '../services/auth.service.js';
import { AuthTokenService } from '../services/token.service.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { Public } from '../decorators/public.decorator.js';
import type { UserPayload } from '../types/auth-request.js';

import { logoutSchema } from '../dto/credentials/logout.dto.js';
import type { LogoutDto } from '../dto/credentials/logout.dto.js';
import { refreshSchema } from '../dto/credentials/refresh.dto.js';
import type { RefreshDto } from '../dto/credentials/refresh.dto.js';

import { refreshResponseSchema } from '../dto/shared/auth-responses.dto.js';
import {
  sessionListItemSchema,
  sessionListSchema,
} from '../dto/shared/session-list-item.dto.js';

@ApiTags('Auth')
@Controller('auth')
export class SessionController {
  constructor(
    private readonly authService: AuthService,
    private readonly authTokenService: AuthTokenService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── POST /api/v1/auth/logout ────────────────────────────────

  @Post('logout')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({ status: 204, description: 'Logged out.' })
  @ApiResponse({
    status: 401,
    description: 'Access token invalid or expired',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  async logout(
    @CurrentUser() user: UserPayload,
    @Body({ schema: logoutSchema }) dto: LogoutDto,
  ) {
    await unwrapResult(this.authService.logout(user.sub, dto.refreshToken));
    return;
  }

  // ── GET /api/v1/auth/sessions ──────────────────────────────

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active sessions for the current user' })
  @ApiResponse({
    status: 200,
    description: 'The active sessions of the current user.',
  })
  @ApiResponse({
    status: 401,
    description: 'Access token invalid or expired',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  // NOTE: JSON array body. Outbound validation uses the item schema (the
  // global serializer validates array items one by one); the OpenAPI
  // registration below uses the array schema (component keeps the former
  // class name — Luminous re-generation shape needs gate review).
  @SerializeOptions({ schema: sessionListItemSchema })
  async listSessions(@CurrentUser() user: UserPayload) {
    const sessions = await unwrapResult(
      this.authTokenService.listSessions(user.sub),
    );
    return sessions;
  }

  // ── DELETE /api/v1/auth/sessions/:sessionId ────────────────

  @Delete('sessions/:sessionId')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Session revoked.',
  })
  @ApiResponse({
    status: 403,
    description: 'Session belongs to another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Access token invalid or expired',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  async revokeSession(
    @CurrentUser() user: UserPayload,
    @Param('sessionId') sessionId: string,
    @Req() request: FastifyRequest,
  ) {
    await unwrapResult(this.authTokenService.revokeById(user.sub, sessionId));
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'session.revoke',
      resourceType: 'session',
      resourceId: sessionId,
    });
    return;
  }

  // ── POST /api/v1/auth/refresh ───────────────────────────────
  // Public — accessToken may be expired, refresh uses the refreshToken body

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token' })
  @ApiResponse({
    status: 200,
    description: 'New token pair for the current session.',
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid, expired or already consumed',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: refreshResponseSchema })
  async refresh(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.refresh(
        dto.refreshToken,
        extractAuthRequestContext(request),
      ),
    );
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
    };
  }
}

// NOTE: array body — the component schema is the full response array; the
// endpoint handler validates per item with the item schema (see above).
registerResponseSchema({
  path: '/api/v1/auth/sessions',
  method: 'get',
  componentName: 'SessionListItemDto',
  schema: sessionListSchema,
  description: 'The active sessions of the current user.',
});

registerResponseSchema({
  path: '/api/v1/auth/refresh',
  method: 'post',
  componentName: 'RefreshResponseDto',
  schema: refreshResponseSchema,
  description: 'New token pair for the current session.',
});
