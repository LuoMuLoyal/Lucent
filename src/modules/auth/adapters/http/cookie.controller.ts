import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  extractAuthRequestContext,
  ProblemDetailsDto,
} from '../../../../common/index.js';
import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import { registerResponseSchema } from '../../../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/domain-failure.exception.js';
import { AuditLogService } from '../../../audit-log/index.js';
import { CookieSessionUseCase } from '../../application/use_cases/cookie_session.js';
import {
  REFRESH_COOKIE_NAME,
  resolveSessionCookiePolicy,
} from '../../domain/session/cookie_policy.js';
import { CurrentUser } from '../../decorators/current-user.decorator.js';
import { Public } from '../../decorators/public.decorator.js';
import type { UserPayload } from '../../types/auth-request.js';
import { clearSessionCookies, writeSessionCookies } from './session_cookies.js';
import {
  sessionLoginSchema,
  sessionRegisterSchema,
  sessionResponseSchema,
  sessionUserSchema,
  type SessionLoginDto,
  type SessionRegisterDto,
  type SessionResponseDto,
  type SessionUserDto,
} from './dto/session.js';
import {
  toCookieTokens,
  toSessionResponse,
  toSessionUser,
} from './presenters/session.js';

/**
 * HttpOnly cookie 会话端点 —— 面向**浏览器里跑的客户端**。
 *
 * Lumine 同时服务 Web 与桌面两个宿主，是同一份前端代码；两个宿主的安全存储
 * 不同，所以会话统一走 httpOnly cookie，让 token 不出现在任何 JS 可读的位置。
 *
 * ## 与 `/auth/login`、`/auth/register` 的关系
 *
 * 那两条是 **Bearer** 契约：token 在响应体里，由客户端自己保管——手机端
 * （Luminous）用的就是它，**不动**。这里提供同一套凭据校验的另一条出口：
 * **token 只进 `Set-Cookie`**。
 *
 * ## 分层位置
 *
 * 本文件只做 HTTP：解析请求、调用例、把结果投影成响应、投 cookie。
 * 凭据校验在 `AuthService`，cookie 属性在 `domain/session/cookie_policy.ts`，
 * 序列化在 `session_cookies.ts`。这里没有第二个判断点。
 *
 * ## 端点
 *
 * | 方法 | 路径 | 鉴权 | 作用 |
 * | --- | --- | --- | --- |
 * | POST | `/auth/session/register` | 公开 | 注册并建立会话 |
 * | POST | `/auth/session/login` | 公开 | 登录并建立会话 |
 * | POST | `/auth/session/refresh` | 公开（凭 refresh cookie） | 轮换会话 |
 * | POST | `/auth/session/logout` | 需 access 凭据 | 吊销会话并清 cookie |
 * | GET | `/auth/me` | 需 access 凭据 | 读取当前用户 |
 *
 * ## 为什么 refresh 是公开的
 *
 * access token 过期后请求必须还能刷新，所以它不能要求 access 凭据。
 * 安全性来自 refresh cookie 的 `HttpOnly` + 轮换：`AuthTokenService` 会先原子
 * 认领旧会话，重复使用立即失效。
 */
@ApiTags('Auth')
@Controller('auth')
export class CookieSessionController {
  constructor(
    private readonly useCase: CookieSessionUseCase,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  // ── POST /api/v1/auth/session/register ──────────────────────

  @Public()
  @Post('session/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register (httpOnly cookie session)' })
  @ApiResponse({
    status: 201,
    description: 'Registered user. Tokens are set as HttpOnly cookies.',
  })
  @ApiResponse({
    status: 400,
    description: 'Verification code expired or does not match',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Anti-enumeration credential failure (email already registered is indistinguishable from a wrong verification code)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: sessionResponseSchema })
  async register(
    @Body({ schema: sessionRegisterSchema }) dto: SessionRegisterDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponseDto> {
    const context = extractAuthRequestContext(request);
    const result = await unwrapResult(this.useCase.register(dto, context));

    this.auditLogService.logFireAndForget({
      ...context,
      userId: result.user.id,
      action: 'user.register',
      resourceType: 'user',
      resourceId: result.user.id,
    });

    writeSessionCookies(reply, toCookieTokens(result.tokens), this.policy());
    return toSessionResponse(result.user, result.tokens.accessTokenExpiresAt);
  }

  // ── POST /api/v1/auth/session/login ─────────────────────────

  @Public()
  @Post('session/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login (httpOnly cookie session)' })
  @ApiResponse({
    status: 200,
    description: 'Authenticated user. Tokens are set as HttpOnly cookies.',
  })
  @ApiResponse({
    status: 400,
    description: 'Login verification code expired or does not match',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Wrong credentials (unified code; account state is not revealed)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Too many failed login attempts',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Authentication method unavailable',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: sessionResponseSchema })
  async login(
    @Body({ schema: sessionLoginSchema }) dto: SessionLoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponseDto> {
    const result = await unwrapResult(
      this.useCase.login(dto, extractAuthRequestContext(request)),
    );

    writeSessionCookies(reply, toCookieTokens(result.tokens), this.policy());
    return toSessionResponse(result.user, result.tokens.accessTokenExpiresAt);
  }

  // ── POST /api/v1/auth/session/refresh ───────────────────────

  @Public()
  @Post('session/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the cookie session' })
  @ApiResponse({
    status: 200,
    description: 'Rotated session; new tokens are set as HttpOnly cookies.',
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token missing, invalid, expired or already consumed',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: sessionResponseSchema })
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponseDto> {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

    if (refreshToken === undefined) {
      // 缺失与无效对外一致：都是 401。这里不必查库。
      clearSessionCookies(reply, this.policy());
      throw new DomainFailureException(this.useCase.refreshFailure());
    }

    const rotated = await unwrapResult(
      this.useCase.rotate(refreshToken, extractAuthRequestContext(request)),
    );

    writeSessionCookies(reply, toCookieTokens(rotated.tokens), this.policy());
    return toSessionResponse(rotated.user, rotated.tokens.accessTokenExpiresAt);
  }

  // ── POST /api/v1/auth/session/logout ────────────────────────

  @Post('session/logout')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout (clears the cookie session)' })
  @ApiResponse({ status: 204, description: 'Logged out; cookies cleared.' })
  @ApiResponse({
    status: 401,
    description: 'Access token invalid or expired (sent as a cookie)',
    type: ProblemDetailsDto,
  })
  async logout(
    @CurrentUser() user: UserPayload,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];

    try {
      if (refreshToken !== undefined) {
        await this.useCase.revoke(user.sub, refreshToken);
      }
    } finally {
      // 无论吊销是否成功，cookie 都必须清掉——否则用户会卡在
      // 「服务端已无会话、浏览器还在反复带旧 cookie」的状态。
      clearSessionCookies(reply, this.policy());
    }

    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'user.logout',
      resourceType: 'user',
      resourceId: user.sub,
    });
  }

  // ── GET /api/v1/auth/me ─────────────────────────────────────

  @Get('me')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Current user (cookie session)' })
  @ApiResponse({ status: 200, description: 'The authenticated user.' })
  @ApiResponse({
    status: 401,
    description: 'Access token invalid or expired (sent as a cookie)',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: sessionUserSchema })
  async me(@CurrentUser() user: UserPayload): Promise<SessionUserDto> {
    const account = await unwrapResult(this.useCase.currentUser(user.sub));

    return toSessionUser(account);
  }

  /** 部署形态 → cookie 属性。每次请求读取，便于运行期调整部署配置。 */
  private policy() {
    return resolveSessionCookiePolicy(
      this.configService.get<{ publicBaseUrl?: string }>(ConfigKey.App)
        ?.publicBaseUrl,
    );
  }
}

// NOTE: 注册响应组件（OpenAPI）。Bearer 那条路为 `/auth/login` 注册过
// `LoginResponse`，这里用 `SessionResponse` 区分，避免组件被覆盖。
registerResponseSchema({
  path: '/api/v1/auth/me',
  method: 'get',
  componentName: 'SessionUser',
  schema: sessionUserSchema,
  description: 'The authenticated user.',
});

registerResponseSchema({
  path: '/api/v1/auth/session/login',
  method: 'post',
  componentName: 'SessionResponse',
  schema: sessionResponseSchema,
  description: 'Authenticated user; tokens are delivered as HttpOnly cookies.',
});

registerResponseSchema({
  path: '/api/v1/auth/session/register',
  method: 'post',
  componentName: 'SessionResponse',
  schema: sessionResponseSchema,
  description: 'Registered user; tokens are delivered as HttpOnly cookies.',
});

registerResponseSchema({
  path: '/api/v1/auth/session/refresh',
  method: 'post',
  componentName: 'SessionResponse',
  schema: sessionResponseSchema,
  description: 'Rotated session; tokens are delivered as HttpOnly cookies.',
});
