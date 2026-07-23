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
import { I18nLang } from 'nestjs-i18n';

import { successEnvelope } from '../../../common/api';
import { extractAuthRequestContext } from '../../../common/helpers';
import { calculateExpiresIn } from '../../../common/helpers';
import { AuthService } from '../services/auth.service';
import { AuthTokenService } from '../services/token.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import type { UserPayload } from '../types/auth-request';

import { LogoutDto } from '../dto/logout.dto';
import { RefreshDto } from '../dto/refresh.dto';

import { RefreshResponseDto, SuccessResponseDto } from '../dto';

@ApiTags('Auth')
@Controller('auth')
export class SessionController {
  constructor(
    private readonly authService: AuthService,
    private readonly authTokenService: AuthTokenService,
  ) {}

  // ── POST /api/v1/auth/logout ────────────────────────────────

  @Post('logout')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User logout' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async logout(@CurrentUser() user: UserPayload, @Body() dto: LogoutDto) {
    await this.authService.logout(user.sub, dto.refreshToken);
    return successEnvelope(null);
  }

  // ── GET /api/v1/auth/sessions ──────────────────────────────

  @Get('sessions')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active sessions for the current user' })
  async listSessions(@CurrentUser() user: UserPayload) {
    const sessions = await this.authTokenService.listSessions(user.sub);
    return successEnvelope(sessions);
  }

  // ── DELETE /api/v1/auth/sessions/:sessionId ────────────────

  @Delete('sessions/:sessionId')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: UserPayload,
    @Param('sessionId') sessionId: string,
    @I18nLang() lang: string,
  ) {
    await this.authTokenService.revokeById(user.sub, sessionId, lang);
    return successEnvelope(null);
  }

  // ── POST /api/v1/auth/refresh ───────────────────────────────
  // Public — accessToken may be expired, refresh uses the refreshToken body

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body() dto: RefreshDto, @Req() request: FastifyRequest) {
    const result = await this.authService.refresh(
      dto.refreshToken,
      extractAuthRequestContext(request),
    );
    return successEnvelope({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
    });
  }
}
