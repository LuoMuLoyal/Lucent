import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AdminRole } from '#generated/prisma/client.js';
import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import {
  QUEUE_NAME_LIST,
  isQueueName,
  queueReadPermission,
  queueWritePermission,
} from '../../../../common/queue/queue-names.js';
import {
  ADMIN_ROLE_PERMISSIONS,
  type AdminPermission,
} from '../../constants/permissions.js';
import { AdminAccessService } from '../../infrastructure/persistence/access.service.js';

interface JwtConfigShape {
  accessSecret: string;
  accessTtl: number;
  issuer: string;
  audience: string;
}

/** Authenticated admin identity, resolved once per panel request. */
export interface QueuePanelPrincipal {
  userId: string;
  role: AdminRole;
  permissions: ReadonlySet<AdminPermission>;
  /** Token expiry (seconds since epoch); caps the session cookie max-age. */
  expiresAtEpochSeconds: number;
}

/** Outcome of authenticating a panel request. */
export type QueuePanelAuthResult =
  | { status: 'ok'; principal: QueuePanelPrincipal }
  | { status: 'unauthorized' }
  | { status: 'forbidden' };

/**
 * Authenticates `/admin/queues` requests with the same JWT the rest of the API
 * trusts, and resolves the admin role into per-queue permission points.
 *
 * This is not a second auth system: it verifies the existing access token
 * (HS512 + issuer/audience) and reads the existing `AdminUser` role, then maps
 * it through {@link ADMIN_ROLE_PERMISSIONS}. A valid non-admin token is
 * `forbidden`, not `unauthorized`.
 */
@Injectable()
export class QueuePanelAuthService {
  private readonly logger = new Logger(QueuePanelAuthService.name);
  private readonly jwt = new JwtService();
  private readonly envJwtConfig: JwtConfigShape;

  constructor(
    configService: ConfigService,
    private readonly adminAccess: AdminAccessService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    this.envJwtConfig =
      configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
  }

  /**
   * Signing config with `JWT_ACCESS_TTL` overlaid from the snapshot. Read per
   * call so a published TTL changes the cookie cap for the next panel login;
   * the secret, issuer and audience stay environment-only.
   */
  private get jwtConfig(): JwtConfigShape {
    const published =
      this.runtimeConfig?.getSnapshot().values[EnvKey.JWT_ACCESS_TTL];
    return typeof published === 'number'
      ? { ...this.envJwtConfig, accessTtl: published }
      : this.envJwtConfig;
  }

  /** Session cookie lifetime cap, from `JWT_ACCESS_TTL`. */
  get sessionTtlSeconds(): number {
    return this.jwtConfig.accessTtl;
  }

  async authenticate(token: string): Promise<QueuePanelAuthResult> {
    const payload = await this.verify(token);
    if (payload === null) {
      return { status: 'unauthorized' };
    }

    const role = await this.adminAccess.getRole(payload.sub);
    if (role === null) {
      return { status: 'forbidden' };
    }

    const principal: QueuePanelPrincipal = {
      userId: payload.sub,
      role,
      permissions: new Set(ADMIN_ROLE_PERMISSIONS[role]),
      expiresAtEpochSeconds: payload.exp,
    };

    // A role without any queue read point (e.g. EDITOR) has no business seeing
    // the panel at all, even the queue list.
    if (!this.canViewPanel(principal)) {
      return { status: 'forbidden' };
    }

    return { status: 'ok', principal };
  }

  /** At least one queue read point. */
  canViewPanel(principal: QueuePanelPrincipal): boolean {
    return QUEUE_NAME_LIST.some((name) =>
      principal.permissions.has(queueReadPermission(name)),
    );
  }

  canReadQueue(principal: QueuePanelPrincipal, name: string): boolean {
    return (
      isQueueName(name) && principal.permissions.has(queueReadPermission(name))
    );
  }

  canWriteQueue(principal: QueuePanelPrincipal, name: string): boolean {
    return (
      isQueueName(name) && principal.permissions.has(queueWritePermission(name))
    );
  }

  /** Write point on every registered queue, required for global pause/resume. */
  canWriteEveryQueue(principal: QueuePanelPrincipal): boolean {
    return QUEUE_NAME_LIST.every((name) =>
      principal.permissions.has(queueWritePermission(name)),
    );
  }

  private async verify(
    token: string,
  ): Promise<{ sub: string; exp: number } | null> {
    try {
      const payload = await this.jwt.verifyAsync<{
        sub?: unknown;
        status?: unknown;
        exp?: unknown;
      }>(token, {
        secret: this.jwtConfig.accessSecret,
        algorithms: ['HS512'],
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      });

      if (typeof payload.sub !== 'string' || payload.status !== 'active') {
        return null;
      }

      const exp =
        typeof payload.exp === 'number'
          ? payload.exp
          : Math.floor(Date.now() / 1000) + this.jwtConfig.accessTtl;
      return { sub: payload.sub, exp };
    } catch (error) {
      // Signature/expiry/audience failure is a transport-level rejection: the
      // caller answers 401, there is nothing to rethrow into the app.
      this.logger.debug(
        `Rejected queue-panel token: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
