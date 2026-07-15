import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest, FastifyReply } from 'fastify';

import { successEnvelope } from '../../../common/api';
import { getRequestClientIp } from '../../../common/helpers/client-ip';
import { AuthService } from '../services/auth.service';
import type { AuthRequestContext } from '../types/auth-request';

import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  AppleOAuthCallbackDto,
  QqOAuthCallbackDto,
  QqOAuthAuthorizeDto,
} from '../dto/oauth.dto';

import { LoginResponseDto, OAuthAuthorizeResponseDto } from '../dto';

import { buildAuthResponse } from './auth-response.helper';

@ApiTags('Auth')
@Controller('auth')
export class OAuthController {
  constructor(private readonly authService: AuthService) {}

  // ── POST /api/v1/auth/oauth/wechat-web/authorize ─────────────

  @Post('oauth/wechat-web/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建微信网页登录授权地址' })
  @ApiBody({ type: OAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  async createWechatWebAuthorizeUrl(@Body() dto?: OAuthAuthorizeDto) {
    const result = await this.authService.createWechatWebAuthorizeUrl(dto);
    return successEnvelope(result);
  }

  // ── POST /api/v1/auth/oauth/wechat-web/callback ──────────────

  @Post('oauth/wechat-web/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信网页登录回调登录' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithWechatWeb(
    @Body() dto: OAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithWechatWeb(
      dto,
      this.getAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── GET /api/v1/auth/oauth/wechat-web/callback ───────────────

  @Get('oauth/wechat-web/callback')
  @ApiOperation({ summary: '微信网页登录浏览器回跳' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  @ApiResponse({ status: 302, description: 'Redirect to desktop callback URI' })
  async redirectWechatWebCallback(
    @Query() dto: OAuthCallbackDto,
    @Res() reply: FastifyReply,
  ) {
    const redirectUrl =
      await this.authService.resolveWechatWebCallbackRedirect(dto);
    reply.redirect(redirectUrl, HttpStatus.FOUND);
  }

  // ── POST /api/v1/auth/oauth/wechat-mobile/callback ───────────

  @Post('oauth/wechat-mobile/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信移动端登录回调' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithWechatMobile(
    @Body() dto: OAuthCodeCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithWechatMobile(
      dto,
      this.getAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/apple/callback ─────────────────

  @Post('oauth/apple/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple 登录回调' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithApple(
    @Body() dto: AppleOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithApple(
      dto,
      this.getAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/qq/authorize ──────────────────

  @Post('oauth/qq/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '创建 QQ 登录授权地址' })
  @ApiBody({ type: QqOAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  async createQqAuthorizeUrl(@Body() dto?: QqOAuthAuthorizeDto) {
    const result = await this.authService.createQqAuthorizeUrl(dto);
    return successEnvelope(result);
  }

  // ── POST /api/v1/auth/oauth/qq/callback ───────────────────

  @Post('oauth/qq/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQ 登录回调' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithQq(
    @Body() dto: QqOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithQq(
      dto,
      this.getAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  private getAuthRequestContext(request: FastifyRequest): AuthRequestContext {
    const userAgent = request.headers['user-agent'];

    return {
      ipAddress: getRequestClientIp(request),
      ...(userAgent !== undefined && { userAgent }),
    };
  }
}
