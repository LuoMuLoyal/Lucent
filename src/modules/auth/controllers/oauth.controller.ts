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

import {
  extractAuthRequestContext,
  ProblemDetailsDto,
} from '../../../common/index.js';
import { unwrapResult } from '../../../common/result/index.js';
import { AuthService } from '../services/auth.service.js';

import {
  OAuthAuthorizeDto,
  OAuthCallbackDto,
  OAuthCodeCallbackDto,
  AppleOAuthCallbackDto,
  QqOAuthCallbackDto,
  QqOAuthAuthorizeDto,
  WeiboOAuthCallbackDto,
  WeiboOAuthAuthorizeDto,
  GoogleOAuthCallbackDto,
  GoogleOAuthAuthorizeDto,
} from '../dto/shared/oauth.dto.js';

import {
  LoginResponseDto,
  OAuthAuthorizeResponseDto,
} from '../dto/shared/auth-responses.dto.js';

import { buildAuthResponse } from './auth-response.helper.js';
import { Public } from '../decorators/public.decorator.js';

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
  @ApiResponse({
    status: 400,
    description: 'Invalid callback URI',
    type: ProblemDetailsDto,
  })
  async createWechatWebAuthorizeUrl(@Body() dto?: OAuthAuthorizeDto) {
    return unwrapResult(this.authService.createWechatWebAuthorizeUrl(dto));
  }

  // ── POST /api/v1/auth/oauth/wechat-web/callback ──────────────

  @Post('oauth/wechat-web/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WeChat web OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid OAuth state or missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth sign-in failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async loginWithWechatWeb(
    @Body() dto: OAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.loginWithWechatWeb(
        dto,
        extractAuthRequestContext(request),
      ),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── GET /api/v1/auth/oauth/wechat-web/callback ───────────────

  @Get('oauth/wechat-web/callback')
  @ApiOperation({ summary: 'WeChat web OAuth browser redirect' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: true })
  @ApiResponse({ status: 302, description: 'Redirect to desktop callback URI' })
  @ApiResponse({
    status: 400,
    description: 'Invalid OAuth state',
    type: ProblemDetailsDto,
  })
  async redirectWechatWebCallback(
    @Query() dto: OAuthCallbackDto,
    @Res() reply: FastifyReply,
  ) {
    const redirectUrl = await unwrapResult(
      this.authService.resolveWechatWebCallbackRedirect(dto),
    );
    reply.redirect(redirectUrl, HttpStatus.FOUND);
  }

  // ── POST /api/v1/auth/oauth/wechat-mobile/callback ───────────

  @Post('oauth/wechat-mobile/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'WeChat mobile OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth sign-in failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async loginWithWechatMobile(
    @Body() dto: OAuthCodeCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.loginWithWechatMobile(
        dto,
        extractAuthRequestContext(request),
      ),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/apple/callback ─────────────────

  @Post('oauth/apple/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple Sign-In callback' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid identity token',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth sign-in failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async loginWithApple(
    @Body() dto: AppleOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.loginWithApple(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/qq/authorize ──────────────────

  @Post('oauth/qq/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create QQ OAuth authorize URL' })
  @ApiBody({ type: QqOAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid callback URI',
    type: ProblemDetailsDto,
  })
  async createQqAuthorizeUrl(@Body() dto?: QqOAuthAuthorizeDto) {
    return unwrapResult(this.authService.createQqAuthorizeUrl(dto));
  }

  // ── POST /api/v1/auth/oauth/qq/callback ───────────────────

  @Post('oauth/qq/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'QQ OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid OAuth state or missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth sign-in failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async loginWithQq(
    @Body() dto: QqOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.loginWithQq(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/weibo/authorize ───────────────

  @Post('oauth/weibo/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create Weibo OAuth authorize URL' })
  @ApiBody({ type: WeiboOAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid callback URI',
    type: ProblemDetailsDto,
  })
  async createWeiboAuthorizeUrl(@Body() dto?: WeiboOAuthAuthorizeDto) {
    return unwrapResult(this.authService.createWeiboAuthorizeUrl(dto));
  }

  // ── POST /api/v1/auth/oauth/weibo/callback ────────────────

  @Post('oauth/weibo/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Weibo OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid OAuth state or missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth sign-in failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async loginWithWeibo(
    @Body() dto: WeiboOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.loginWithWeibo(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }

  // ── POST /api/v1/auth/oauth/google/authorize ──────────────

  @Post('oauth/google/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create Google OAuth authorize URL' })
  @ApiBody({ type: GoogleOAuthAuthorizeDto, required: false })
  @ApiResponse({ status: 200, type: OAuthAuthorizeResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid callback URI',
    type: ProblemDetailsDto,
  })
  async createGoogleAuthorizeUrl(@Body() dto?: GoogleOAuthAuthorizeDto) {
    return unwrapResult(this.authService.createGoogleAuthorizeUrl(dto));
  }

  // ── POST /api/v1/auth/oauth/google/callback ───────────────

  @Post('oauth/google/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google OAuth callback login' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid OAuth state or missing/malformed callback credential',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth sign-in failed',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'OAuth identity is already linked to another account',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'OAuth provider rejected the exchange or returned an unusable profile',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 504,
    description: 'OAuth provider timed out',
    type: ProblemDetailsDto,
  })
  async loginWithGoogle(
    @Body() dto: GoogleOAuthCallbackDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await unwrapResult(
      this.authService.loginWithGoogle(dto, extractAuthRequestContext(request)),
    );
    return buildAuthResponse(result.user, result);
  }
}
