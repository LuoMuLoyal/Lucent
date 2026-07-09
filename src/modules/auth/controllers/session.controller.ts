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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { successEnvelope } from '../../../common/api';
import { getRequestClientIp } from '../../../common/helpers/client-ip';
import { ConfigService } from '@nestjs/config';
import { ConfigKey } from '../../../config/config-keys.enum';
import { calculateExpiresIn } from '../../../common/helpers/date-time.utils';
import { AuthService } from '../services/auth.service';
import { AuthTokenService } from '../services/token.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthRequestContext, UserPayload } from '../types/auth-request';

import { LogoutDto } from '../dto/logout.dto';
import { RefreshDto } from '../dto/refresh.dto';

import { RefreshResponseDto, SuccessResponseDto } from '../dto';

@ApiTags('Auth')
@Controller('auth')
export class SessionController {
  constructor(
    private readonly authService: AuthService,
    private readonly authTokenService: AuthTokenService,
    private readonly configService: ConfigService,
  ) {}

  // ── POST /api/v1/auth/logout ────────────────────────────────

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登出' })
  @ApiResponse({ status: 200, type: SuccessResponseDto })
  async logout(@CurrentUser() user: UserPayload, @Body() dto: LogoutDto) {
    await this.authService.logout(user.sub, dto.refreshToken);
    return successEnvelope(null);
  }

  // ── GET /api/v1/auth/sessions ──────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '列出当前用户的活跃会话' })
  async listSessions(@CurrentUser() user: UserPayload) {
    const sessions = await this.authTokenService.listSessions(user.sub);
    return successEnvelope(sessions);
  }

  // ── DELETE /api/v1/auth/sessions/:sessionId ────────────────

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '撤销指定会话' })
  async revokeSession(
    @CurrentUser() user: UserPayload,
    @Param('sessionId') sessionId: string,
  ) {
    await this.authTokenService.revokeById(user.sub, sessionId);
    return successEnvelope(null);
  }

  // ── POST /api/v1/auth/refresh ───────────────────────────────
  // No auth guard — accessToken may be expired

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiResponse({ status: 200, type: RefreshResponseDto })
  async refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    const result = await this.authService.refresh(
      dto.refreshToken,
      this.getAuthRequestContext(request),
    );
    return successEnvelope({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: calculateExpiresIn(result.accessTokenExpiresAt),
    });
  }

  private get trustProxy(): boolean {
    return this.configService.get<boolean>(
      `${ConfigKey.App}.trustProxy`,
      false,
    );
  }

  private getAuthRequestContext(request: Request): AuthRequestContext {
    const userAgent = request.headers['user-agent'];

    return {
      ipAddress: getRequestClientIp(request, this.trustProxy),
      ...(userAgent !== undefined && { userAgent }),
    };
  }
}
