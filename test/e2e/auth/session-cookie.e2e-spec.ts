import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { createHash } from 'node:crypto';

import {
  createTestApp,
  cleanupDatabase,
  seedVerificationCode,
  uniqueEmail,
} from '../../helpers/e2e-helpers.js';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers.js';

/**
 * HttpOnly cookie session API (Lumine 的 Web + 桌面两端共用这条契约).
 *
 * 与 `auth.e2e-spec.ts`（Bearer 契约）的分工：
 * - Bearer 那条路必须**继续**把 token 放在响应体里（手机端 Luminous 依赖它）；
 * - 这条路必须**绝不**把 token 放进响应体，只进 `Set-Cookie`。
 *
 * 所以这里除了验证「能不能登录」，更重要的是钉住「token 不出现在 body 里」这条
 * 安全属性——它是方案 A 的全部理由。
 */

const SESSION_REGISTER_PATH = '/api/v1/auth/browser/register';
const SESSION_LOGIN_PATH = '/api/v1/auth/browser/login';
const SESSION_REFRESH_PATH = '/api/v1/auth/browser/refresh';
const SESSION_LOGOUT_PATH = '/api/v1/auth/browser/logout';
const ACCOUNT_PATH = '/api/v1/account';
const SEND_CODE_PATH = '/api/v1/auth/send-verification-code';

const TEST_PASSWORD = 'LucentE2e!2345';

interface SessionUserDto {
  id: string;
  email: string;
  nickname: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionResponseBody {
  user: SessionUserDto;
  expiresIn: number;
}

/** 与 `AuthTokenService.hashRefreshToken` 同算法：sha256(token) 的 hex。 */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 从 supertest 的响应里取全部 Set-Cookie 行。 */
function setCookies(response: SupertestResponse): string[] {
  const raw = response.headers['set-cookie'];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

/** 取某个 cookie 的 `name=value` 片段，用来回传给服务端。 */
function cookiePair(
  response: request.Response,
  name: string,
): string | undefined {
  return setCookies(response)
    .map((line) => line.split(';')[0]!.trim())
    .find((pair) => pair.startsWith(`${name}=`));
}

function cookieValue(
  response: request.Response,
  name: string,
): string | undefined {
  return cookiePair(response, name)?.slice(name.length + 1);
}

describe('Cookie Session API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  /**
   * 注册一个用户并返回**未使用的邮箱**（供后续登录用）。
   *
   * 与 bearer e2e 同样的做法：验证码服务只存哈希，所以直接往缓存里种哈希，
   * 而不是真的收信。
   */
  async function seedVerifiedEmail(): Promise<{ email: string; code: string }> {
    const email = uniqueEmail('cookiesession');

    await request(app.getHttpServer())
      .post(SEND_CODE_PATH)
      .set('x-forwarded-for', '198.51.100.7')
      .send({ email, scene: 'register' })
      .expect(200);

    const code = '123456';
    await seedVerificationCode(ctx, 'register', email, code);

    return { email, code };
  }

  /** 注册并通过 cookie 会话直接建立登录态。 */
  async function registerSession(
    email: string,
    code: string,
  ): Promise<SupertestResponse> {
    const response = await request(app.getHttpServer())
      .post(SESSION_REGISTER_PATH)
      .send({
        email,
        password: TEST_PASSWORD,
        code,
        nickname: 'CookieTester',
      });

    expect(response.status).toBe(201);
    return response;
  }

  // ════════════════════════════════════════════════════════════
  // POST /auth/browser/register — 建立会话
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/browser/register', () => {
    it('201 + 两个 HttpOnly cookie，且 body 里没有 token', async () => {
      const { email, code } = await seedVerifiedEmail();

      const response = await registerSession(email, code);

      // 安全属性 1：响应体只有用户资料与 expiresIn，不含 tokens。
      const body = response.body as SessionResponseBody &
        Record<string, unknown>;
      expect(body.user.email).toBe(email);
      expect(typeof body.expiresIn).toBe('number');
      expect(body).not.toHaveProperty('tokens');
      expect(JSON.stringify(body)).not.toContain('refreshToken');
      expect(JSON.stringify(body)).not.toContain('accessToken');

      // 安全属性 2：两个 cookie 都带 HttpOnly。
      const cookies = setCookies(response);
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Path=/api/v1');
      }

      // 安全属性 3：access 与 refresh 分属两个不同 cookie。
      expect(cookieValue(response, 'lucent_session')).toBeTruthy();
      expect(cookieValue(response, 'lucent_refresh')).toBeTruthy();
      expect(cookieValue(response, 'lucent_session')).not.toBe(
        cookieValue(response, 'lucent_refresh'),
      );
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /auth/browser/login + GET /account
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/browser/login', () => {
    it('登录后可用 cookie 访问 /account', async () => {
      const { email, code } = await seedVerifiedEmail();
      await registerSession(email, code);

      const login = await request(app.getHttpServer())
        .post(SESSION_LOGIN_PATH)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const sessionCookie = cookiePair(login, 'lucent_session');
      expect(sessionCookie).toBeDefined();

      const me = await request(app.getHttpServer())
        .get(ACCOUNT_PATH)
        .set('Cookie', sessionCookie!)
        .expect(200);

      // `/account` 返回的是 AccountDto（账户资料的唯一读入口），
      // 这里只断言 cookie 已生效，不比对字段形状。
      const account = me.body as unknown as {
        email: string;
        hasPassword: boolean;
      };
      expect(account.email).toBe(email);
      // 本地注册的账号应当有密码。
      expect(account.hasPassword).toBe(true);

      // 不带凭据时必须拒绝——证明上一步真的是 cookie 在起作用。
      await request(app.getHttpServer()).get(ACCOUNT_PATH).expect(401);
    });

    it('错误密码返回统一的 401，不泄露账号是否存在', async () => {
      const { email, code } = await seedVerifiedEmail();
      await registerSession(email, code);

      const wrongPassword = await request(app.getHttpServer())
        .post(SESSION_LOGIN_PATH)
        .send({ email, password: 'WrongPassword!2345' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post(SESSION_LOGIN_PATH)
        .send({ email: uniqueEmail('ghost'), password: TEST_PASSWORD })
        .expect(401);

      // 反枚举：两种失败的 code 必须一致。
      expect((wrongPassword.body as { code?: string }).code).toBe(
        (unknownEmail.body as { code?: string }).code,
      );
    });

    it('缺少凭据时返回 401 而不是 500', async () => {
      await request(app.getHttpServer())
        .post(SESSION_LOGIN_PATH)
        .send({ email: uniqueEmail('nocreds') })
        .expect(401);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /auth/browser/refresh — 轮换
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/browser/refresh', () => {
    it('用 refresh cookie 换出新的一对 cookie', async () => {
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);

      const rotated = await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', cookiePair(registered, 'lucent_refresh')!)
        .expect(200);

      const body = rotated.body as SessionResponseBody &
        Record<string, unknown>;
      expect(body.user.email).toBe(email);
      expect(body).not.toHaveProperty('tokens');

      // 轮换必须换发新的 refresh token——否则被偷的旧 cookie 永远有效。
      expect(cookieValue(rotated, 'lucent_refresh')).not.toBe(
        cookieValue(registered, 'lucent_refresh'),
      );
    });

    it('没有 refresh cookie 时返回 401 并清掉 cookie', async () => {
      const response = await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .expect(401);

      const cookies = setCookies(response);
      expect(cookies.length).toBeGreaterThan(0);
      // 清理用的 Set-Cookie 必须 Max-Age=0。
      for (const cookie of cookies) {
        expect(cookie).toContain('Max-Age=0');
      }
    });

    it('已消费的 refresh cookie 不能重复使用', async () => {
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);
      const oldRefresh = cookiePair(registered, 'lucent_refresh')!;

      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', oldRefresh)
        .expect(200);

      // 同一枚 refresh cookie 再刷一次必须失败（轮换已作废它）。
      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', oldRefresh)
        .expect(401);
    });

    it('宽限窗口内的重放只拒绝，不销毁整族', async () => {
      // 两个标签页同时刷新时，输的一方必须失败，但不能把赢的一方也踢下线。
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);
      const oldRefresh = cookiePair(registered, 'lucent_refresh')!;

      const rotated = await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', oldRefresh)
        .expect(200);

      // 立刻重放：处在宽限窗口内。
      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', oldRefresh)
        .expect(401);

      // 赢家的新 refresh cookie 仍然有效。
      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', cookiePair(rotated, 'lucent_refresh')!)
        .expect(200);
    });

    it('宽限窗口外的重放判定为盗用，撤销整族', async () => {
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);
      const oldRefresh = cookiePair(registered, 'lucent_refresh')!;

      const rotated = await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', oldRefresh)
        .expect(200);
      const newRefresh = cookiePair(rotated, 'lucent_refresh')!;

      // 把旧行的 rotatedAt 推到宽限窗口之外——模拟「token 被偷后过了一阵才重放」。
      await ctx.prisma.userSession.updateMany({
        where: {
          refreshTokenHash: hashRefreshToken(oldRefresh.split('=')[1]!),
        },
        data: { rotatedAt: new Date(Date.now() - 5 * 60 * 1000) },
      });

      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', oldRefresh)
        .expect(401);

      // 关键断言：整族已被撤销，合法的新 refresh token 也必须失效。
      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', newRefresh)
        .expect(401);
    });

    it('轮换产生的会话行保留在同族里，且不出现在活跃会话列表', async () => {
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);
      const accessCookie = cookiePair(registered, 'lucent_session')!;

      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', cookiePair(registered, 'lucent_refresh')!)
        .expect(200);

      const sessions = await ctx.prisma.userSession.findMany({
        where: { user: { email } },
        orderBy: { createdAt: 'asc' },
      });

      // 两次签发 = 两行：一行已轮换（tombstone），一行活跃。
      expect(sessions).toHaveLength(2);
      expect(new Set(sessions.map((s) => s.familyId)).size).toBe(1);
      expect(sessions.filter((s) => s.rotatedAt !== null)).toHaveLength(1);

      const listed = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Cookie', accessCookie)
        .expect(200);

      // tombstone 不是活跃会话。
      expect(listed.body as unknown[]).toHaveLength(1);
    });
  });

  // ════════════════════════════════════════════════════════════
  // POST /auth/browser/logout
  // ════════════════════════════════════════════════════════════

  describe('POST /api/v1/auth/browser/logout', () => {
    it('登出后 cookie 被清掉，且会话被吊销', async () => {
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);
      const accessCookie = cookiePair(registered, 'lucent_session')!;
      const refreshCookie = cookiePair(registered, 'lucent_refresh')!;

      // 鉴权来自 access cookie，refresh cookie 用来定位要吊销的会话。
      const logout = await request(app.getHttpServer())
        .post(SESSION_LOGOUT_PATH)
        .set('Cookie', `${accessCookie}; ${refreshCookie}`)
        .expect(204);

      const cleared = setCookies(logout);
      expect(cleared).toHaveLength(2);
      for (const line of cleared) {
        expect(line).toContain('Max-Age=0');
      }

      // access JWT 本身无状态、仍在有效期内，但会话记录已被吊销——
      // 「登出真的生效」的判据是 refresh 失败，而不是 access 立刻 401。
      await request(app.getHttpServer())
        .post(SESSION_REFRESH_PATH)
        .set('Cookie', refreshCookie)
        .expect(401);
    });

    it('缺少 access 凭据时返回 401，不静默成功', async () => {
      const { email, code } = await seedVerifiedEmail();
      const registered = await registerSession(email, code);

      await request(app.getHttpServer())
        .post(SESSION_LOGOUT_PATH)
        .set('Cookie', cookiePair(registered, 'lucent_refresh')!)
        .expect(401);
    });
  });
});
