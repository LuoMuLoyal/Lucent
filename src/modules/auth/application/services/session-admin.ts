import { Injectable } from '@nestjs/common';
import { unwrapResult } from '../../../../common/result/index.js';
import { AuditLogService } from '../../../audit-log/index.js';
import { SessionTokens } from './session-tokens.js';

/**
 * Administrative session-revocation surface used by the admin console. Wraps
 * `SessionTokens` so the `auth` module remains the single writer for session
 * rows, and records an audit entry for `users:write` admin actions.
 */
@Injectable()
export class AuthSessionAdminService {
  constructor(
    private readonly sessionTokens: SessionTokens,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Revokes every session belonging to the user. Idempotent. */
  async revokeAllForUser(actorUserId: string, userId: string): Promise<void> {
    await unwrapResult(this.sessionTokens.revokeAll(userId));
    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.users.sessions.revoke_all',
        resourceType: 'user_session',
        resourceId: userId,
      }),
    );
  }

  /**
   * Revokes one session owned by `userId`. Returns `false` when the session does
   * not exist or belongs to a different user, so the admin endpoint can answer
   * 404 without leaking cross-user session ids.
   */
  async revokeSessionForUser(
    actorUserId: string,
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const revoked = await this.sessionTokens
      .revokeById(userId, sessionId)
      .match(
        () => true,
        () => false,
      );
    if (!revoked) return false;

    await unwrapResult(
      this.auditLog.log({
        userId: actorUserId,
        action: 'admin.users.sessions.revoke',
        resourceType: 'user_session',
        resourceId: sessionId,
        metadata: { targetUserId: userId },
      }),
    );
    return true;
  }
}
