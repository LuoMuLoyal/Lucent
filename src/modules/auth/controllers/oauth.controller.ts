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

import { successEnvelope } from '../../../common';
import { extractAuthRequestContext } from '../../../common';
import { AuthService } from '../services/auth.service';

import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  AppleOAuthCallbackDto,
  QqOAuthCallbackDto,
  QqOAuthAuthorizeDto,
} from '../dto/shared/oauth.dto';

import {
  LoginResponseDto,
  OAuthAuthorizeResponseDto,
} from '../dto/shared/auth-responses.dto';

import { buildAuthResponse } from './auth-response.helper';
import { Public } from '../decorators/public.decorator';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class OAuthController {
  constructor(private readonly authService: AuthService) {}

  // ── POST /api/v1/auth/oauth/wechat-web/authorize ─────────────

  @Post('oauth/wechat-web/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create WeChat web OAuth authorize URL' })
  @ApiBody({ type: OAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  async createWechatWebAuthorizeUrl(@Body() dto?: OAuthAuthorizeDto) {
    const result = await this.authService.createWechatWebAuthorizeUrl(dto);
    return successEnvelope(result);
  }

  // ── POST /api/v1/auth/oauth/wechat-web/callback ──────────────

  @Post('oauth/wechat-web/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WeChat web OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithWechatWeb(
    @Body() dto: OAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithWechatWeb(
      dto,
      extractAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── GET /api/v1/auth/oauth/wechat-web/callback ───────────────

  @Get('oauth/wechat-web/callback')
  @ApiOperation({ summary: 'WeChat web OAuth browser redirect' })
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
  @ApiOperation({ summary: 'WeChat mobile OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithWechatMobile(
    @Body() dto: OAuthCodeCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithWechatMobile(
      dto,
      extractAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/apple/callback ─────────────────

  @Post('oauth/apple/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple Sign-In callback' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithApple(
    @Body() dto: AppleOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithApple(
      dto,
      extractAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/qq/authorize ──────────────────

  @Post('oauth/qq/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create QQ OAuth authorize URL' })
  @ApiBody({ type: QqOAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  async createQqAuthorizeUrl(@Body() dto?: QqOAuthAuthorizeDto) {
    const result = await this.authService.createQqAuthorizeUrl(dto);
    return successEnvelope(result);
  }

  // ── POST /api/v1/auth/oauth/qq/callback ───────────────────

  @Post('oauth/qq/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQ OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async loginWithQq(
    @Body() dto: QqOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.authService.loginWithQq(
      dto,
      extractAuthRequestContext(request),
    );
    return buildAuthResponse(result.user, result);
  }
}
