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
import { unwrapResult } from '../../../common/result/index.js';
import { AuditLogService } from '../../audit-log/index.js';
import { AuthService } from '../services/auth.service.js';
import { AuthTokenService } from '../services/token.service.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { Public } from '../decorators/public.decorator.js';
import type { UserPayload } from '../types/auth-request.js';

import { LogoutDto } from '../dto/credentials/logout.dto.js';
import { RefreshDto } from '../dto/credentials/refresh.dto.js';

import { RefreshResponseDto } from '../dto/shared/auth-responses.dto.js';
import { SessionListItemDto } from '../dto/shared/session-list-item.dto.js';

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
  async logout(@CurrentUser() user: UserPayload, @Body() dto: LogoutDto) {
    await unwrapResult(this.authService.logout(user.sub, dto.refreshToken));
    return;
  }

  // ── GET /api/v1/auth/sessions ──────────────────────────────

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active sessions for the current user' })
  @ApiResponse({ status: 200, type: [SessionListItemDto] })
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
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid, expired or already consumed',
    type: ProblemDetailsDto,
  })
  async refresh(@Body() dto: RefreshDto, @Req() request: FastifyRequest) {
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
