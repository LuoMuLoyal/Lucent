import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '#generated/prisma/client.js';
import type { AdminAccessService } from './access.service.js';
import { QueuePanelAuthService } from './queue-panel-auth.service.js';

const ACCESS_SECRET = 'queue-panel-test-secret-value-0123456789';
const ISSUER = 'lucent';
const AUDIENCE = 'lucent-client';
const ACCESS_TTL_SECONDS = 3600;

const jwt = new JwtService();

async function signAccessToken(options: {
  sub: string;
  status?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  return jwt.signAsync(
    { sub: options.sub, email: `${options.sub}@example.com`, status: options.status ?? 'active' },
    {
      secret: ACCESS_SECRET,
      algorithm: 'HS512',
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: options.expiresInSeconds ?? ACCESS_TTL_SECONDS,
    },
  );
}

function createConfigService(): ConfigService {
  return {
    getOrThrow: () => ({
      accessSecret: ACCESS_SECRET,
      accessTtl: ACCESS_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
  } as unknown as ConfigService;
}

function createAccessService(
  roles: Record<string, AdminRole>,
): AdminAccessService {
  return {
    getRole: (userId: string) => Promise.resolve(roles[userId] ?? null),
  } as unknown as AdminAccessService;
}

function createService(roles: Record<string, AdminRole>): QueuePanelAuthService {
  return new QueuePanelAuthService(createConfigService(), createAccessService(roles));
}

describe('QueuePanelAuthService', () => {
  it('authenticates an active admin and exposes the full queue permission set', async () => {
    const service = createService({ 'admin-1': AdminRole.ADMIN });
    const token = await signAccessToken({ sub: 'admin-1' });

    const result = await service.authenticate(token);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.principal.userId).toBe('admin-1');
    expect(result.principal.role).toBe(AdminRole.ADMIN);
    expect(service.canReadQueue(result.principal, 'lucent-cron')).toBe(true);
    expect(service.canWriteQueue(result.principal, 'lucent-cron')).toBe(true);
    expect(service.canWriteEveryQueue(result.principal)).toBe(true);
  });

  it('treats a valid token without an admin role as forbidden', async () => {
    const service = createService({});
    const token = await signAccessToken({ sub: 'plain-user' });

    await expect(service.authenticate(token)).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('rejects a token that is not active', async () => {
    const service = createService({ 'user-1': AdminRole.SUPER_ADMIN });
    const token = await signAccessToken({ sub: 'user-1', status: 'disabled' });

    await expect(service.authenticate(token)).resolves.toEqual({
      status: 'unauthorized',
    });
  });

  it('rejects a tampered or expired token as unauthorized', async () => {
    const service = createService({ 'user-1': AdminRole.SUPER_ADMIN });
    const expired = await signAccessToken({
      sub: 'user-1',
      expiresInSeconds: -10,
    });

    await expect(service.authenticate('not-a-jwt')).resolves.toEqual({
      status: 'unauthorized',
    });
    await expect(service.authenticate(expired)).resolves.toEqual({
      status: 'unauthorized',
    });
  });

  it('scopes a viewer to queue reads and refuses panel access without any queue read', async () => {
    const service = createService({
      'viewer-1': AdminRole.VIEWER,
      'editor-1': AdminRole.EDITOR,
    });

    const viewer = await service.authenticate(
      await signAccessToken({ sub: 'viewer-1' }),
    );
    expect(viewer.status).toBe('ok');
    if (viewer.status === 'ok') {
      expect(service.canViewPanel(viewer.principal)).toBe(true);
      expect(service.canReadQueue(viewer.principal, 'lucent-mail')).toBe(true);
      expect(service.canWriteQueue(viewer.principal, 'lucent-mail')).toBe(false);
      expect(service.canWriteEveryQueue(viewer.principal)).toBe(false);
    }

    await expect(
      service.authenticate(await signAccessToken({ sub: 'editor-1' })),
    ).resolves.toEqual({ status: 'forbidden' });
  });

  it('never authorizes an unknown queue name', async () => {
    const service = createService({ 'admin-1': AdminRole.SUPER_ADMIN });
    const result = await service.authenticate(
      await signAccessToken({ sub: 'admin-1' }),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(service.canReadQueue(result.principal, 'ghost-queue')).toBe(false);
    expect(service.canWriteQueue(result.principal, 'ghost-queue')).toBe(false);
  });
});
