import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type {
  BeforeHookResult,
  BullBoardRequest,
  HookContext,
} from '@bull-board/api/typings/app';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { extractAuthRequestContext } from '../../../../common/index.js';
import { BullmqQueueFactory } from '../../../../common/queue/queue.factory.js';
import { AuditLogService } from '../../../audit-log/index.js';
import {
  QUEUE_PANEL_API_PREFIX,
  QUEUE_PANEL_AUDIT_RESOURCE_TYPE,
  QUEUE_PANEL_COOKIE_NAME,
  QUEUE_PANEL_PATH,
  QUEUE_PANEL_TOKEN_QUERY_PARAM,
} from '../../constants/queue-panel.constants.js';
import {
  QueuePanelAuthService,
  type QueuePanelPrincipal,
} from './queue-panel-auth.service.js';
import {
  isReadMethod,
  isSafeCookieValue,
  pathnameOf,
  readBearerToken,
  readQueryString,
  resolveQueueMutation,
  stripQueryParam,
} from './queue-panel.utils.js';

/** Fastify request carrying the principal resolved by {@link QueuePanelService.onRequest}. */
interface QueuePanelRequest extends FastifyRequest {
  queuePanelPrincipal?: QueuePanelPrincipal;
}

const UNAUTHORIZED_BODY = { error: 'AUTH_REQUIRED' };
const FORBIDDEN_BODY = { error: 'FORBIDDEN' };

/**
 * Serves the bull-board queue dashboard at `/admin/queues` and enforces the
 * existing admin auth/permission model on every request.
 *
 * Nothing here is a second auth system: requests are authenticated with the
 * same access JWT, and per-queue authorization reads the same `AdminUser` role
 * through {@link QueuePanelAuthService}. Capability is fully open (no
 * `readOnlyMode`) — retry, clean, pause, resume, promote and add-job are all
 * available — so every non-GET request is written to the audit log.
 *
 * The bundled UI cannot attach our `Authorization` header to its own XHRs, so
 * operator access is a handshake: opening the panel once with
 * `?access_token=<jwt>` mints a short-lived `HttpOnly` / `SameSite=Lax` cookie
 * scoped to the panel path; the UI then authenticates with that cookie.
 */
@Injectable()
export class QueuePanelService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueuePanelService.name);
  /**
   * Principal resolved in the Fastify `onRequest` hook, shared with the
   * bull-board `before`/visibility hooks. Keyed on the request `headers`
   * object, whose identity bull-board's Fastify adapter passes through
   * verbatim — so no re-verification, no spoofable header.
   */
  private readonly principals = new WeakMap<object, QueuePanelPrincipal>();

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly factory: BullmqQueueFactory,
    private readonly auth: QueuePanelAuthService,
    private readonly audit: AuditLogService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const fastify =
      this.httpAdapterHost.httpAdapter.getInstance<FastifyInstance>();

    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(QUEUE_PANEL_PATH);

    const adapters = this.factory.getQueues().map((queue) => {
      const adapter = new BullMQAdapter(queue);
      // Native per-queue read scoping: bull-board filters the queue list,
      // single-queue views, workers and schedulers through this guard.
      adapter.setVisibilityGuard((request) => {
        const principal = this.principals.get(request.headers);
        return (
          principal !== undefined &&
          this.auth.canReadQueue(principal, queue.name)
        );
      });
      return adapter;
    });

    createBullBoard({
      queues: adapters,
      serverAdapter,
      options: {
        uiConfig: { boardTitle: 'Lucent Queues' },
        handlerHooks: { before: (context) => this.authorize(context) },
      },
    });

    // Encapsulated scope: the onRequest/onResponse hooks apply to the panel's
    // HTML, assets and API routes only, never to the rest of the API.
    await fastify.register(
      async (scope) => {
        scope.addHook('onRequest', (request, reply) =>
          this.onRequest(request, reply),
        );
        scope.addHook('onResponse', (request, reply) => {
          this.onResponse(request, reply);
        });
        await scope.register(serverAdapter.registerPlugin());
      },
      { prefix: QUEUE_PANEL_PATH },
    );

    this.logger.log(
      `Queue panel served at ${QUEUE_PANEL_PATH} (${String(adapters.length)} queue(s))`,
    );
  }

  /**
   * Authenticates every panel request and, when the request carries a token in
   * the query string, completes the cookie handshake before anything else.
   */
  private async onRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    const queryToken = readQueryString(
      request.query,
      QUEUE_PANEL_TOKEN_QUERY_PARAM,
    );
    if (
      request.method === 'GET' &&
      queryToken !== null &&
      (await this.trySessionHandshake(request, reply))
    ) {
      return reply.redirect(
        stripQueryParam(request.url, QUEUE_PANEL_TOKEN_QUERY_PARAM),
      );
    }

    const token =
      readBearerToken(request.headers.authorization) ??
      request.cookies[QUEUE_PANEL_COOKIE_NAME] ?? null;
    const result =
      token === null
        ? ({ status: 'unauthorized' } as const)
        : await this.auth.authenticate(token);

    if (result.status !== 'ok') {
      reply
        .code(result.status === 'forbidden' ? 403 : 401)
        .type('application/json; charset=utf-8')
        .send(result.status === 'forbidden' ? FORBIDDEN_BODY : UNAUTHORIZED_BODY);
      return reply;
    }

    this.principals.set(request.headers, result.principal);
    (request as QueuePanelRequest).queuePanelPrincipal = result.principal;
    return undefined;
  }

  /**
   * If the request carries `?access_token=<jwt>` and the token is valid, mints
   * the panel session cookie and returns `true` so the caller can redirect to
   * the token-free URL. Never authenticates the request itself.
   */
  private async trySessionHandshake(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> {
    const queryToken = readQueryString(
      request.query,
      QUEUE_PANEL_TOKEN_QUERY_PARAM,
    );
    if (queryToken === null) {
      return false;
    }

    const result = await this.auth.authenticate(queryToken);
    if (result.status !== 'ok' || !isSafeCookieValue(queryToken)) {
      return false;
    }

    reply.setCookie(QUEUE_PANEL_COOKIE_NAME, queryToken, {
      path: QUEUE_PANEL_PATH,
      maxAge: this.cookieMaxAgeSeconds(result.principal),
      secure: request.protocol === 'https',
      httpOnly: true,
      // Lax：跨站 POST 从不携带它，于是 cookie 鉴权的变更接口天然免疫 CSRF，
      // 不需要额外的 token 头。
      sameSite: 'lax',
    });
    return true;
  }

  /**
   * Records every non-GET panel API request — successful or rejected — so
   * "who retried / cleaned / paused what" is always attributable.
   */
  private onResponse(request: FastifyRequest, reply: FastifyReply): void {
    const principal = (request as QueuePanelRequest).queuePanelPrincipal;
    if (principal === undefined || isReadMethod(request.method)) {
      return;
    }

    const pathname = pathnameOf(request.url);
    if (!pathname.startsWith(`${QUEUE_PANEL_API_PREFIX}/`)) {
      return;
    }

    const { queueName, action } = resolveQueueMutation(pathname);
    const { ipAddress, userAgent } = extractAuthRequestContext(request);
    this.audit.logFireAndForget({
      userId: principal.userId,
      action,
      resourceType: QUEUE_PANEL_AUDIT_RESOURCE_TYPE,
      ...(queueName === null ? {} : { resourceId: queueName }),
      metadata: {
        method: request.method,
        path: pathname,
        statusCode: reply.statusCode,
      },
      ipAddress,
      ...(userAgent === undefined ? {} : { userAgent }),
    });
  }

  /**
   * Write authorization for the bull-board API. Reads are already scoped by the
   * per-adapter visibility guard; here a queue-targeted mutation needs that
   * queue's write point, and a global mutation (pause/resume all) needs write
   * on every registered queue. Unknown queue names fall through to the board's
   * own 404.
   */
  private authorize(context: HookContext): BeforeHookResult {
    const principal = this.principals.get(context.request.headers);
    if (principal === undefined) {
      return { allow: false, status: 403 };
    }
    if (isReadMethod(context.method)) {
      return;
    }

    const queueName = readQueueName(context.request);
    if (queueName !== null) {
      if (!this.auth.canWriteQueue(principal, queueName)) {
        return { allow: false, status: 403 };
      }
      return;
    }

    if (!this.auth.canWriteEveryQueue(principal)) {
      return { allow: false, status: 403 };
    }
    return;
  }

  private cookieMaxAgeSeconds(principal: QueuePanelPrincipal): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const remaining = principal.expiresAtEpochSeconds - nowSeconds;
    return Math.max(0, Math.min(this.auth.sessionTtlSeconds, remaining));
  }
}

/** Reads the `:queueName` route param when the request targets one queue. */
function readQueueName(request: BullBoardRequest): string | null {
  const value: unknown = request.params['queueName'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
