import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { AppModule } from '../../../src/app.module.js';
import { setupApp } from '../../../src/setup-app.js';
import { PrismaService } from '../../../src/prisma/index.js';
import { HealthEventKind, MedicineSource } from '#generated/prisma/client.js';
import { ConfigKey } from '../../../src/config/env/config-keys.enum.js';
import {
  bearer,
  cleanupDatabase,
  createAccessToken,
  createTestUser,
  type TestUser,
} from '../../helpers/e2e-helpers.js';

/**
 * 用药全景端点的 e2e。
 *
 * ## 测什么
 *
 * 鉴权边界（只能看自己的）、空集合的语义（空聚合而不是错误）、
 * 以及**无法解析成分的条目不让整体失败**。
 *
 * ## 不测什么
 *
 * 具体的重复成分判定——那需要真实的药品详情，而 dev 库知识是空的。
 * 判定逻辑本身在 `domain/services/medication-overview.spec.ts` 里用夹具覆盖。
 * 这里只验证「端点能跑通并给出结构正确的空聚合」。
 */

const OVERVIEW_PATH = '/api/v1/medicines/medication-overview';
const AUTH_HEADER = 'Authorization';

interface OverviewBody {
  totalMedicines: number;
  resolvableMedicines: number;
  duplicates: Array<{
    ingredientKey: string;
    entryIds: string[];
    severity: string;
  }>;
  sourceOverlaps: Array<{
    source: string;
    medicineCount: number;
    displayNames: string[];
  }>;
}

describe('Medication Overview API (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let user: TestUser;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: true }),
      { bodyParser: false },
    );
    await setupApp(app, app.get(ConfigService));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    await cleanupDatabase(prisma);
    user = await createTestUser(prisma, undefined, 'OverviewUser');
    token = await createAccessToken(
      jwtService,
      configService,
      user.id,
      `${user.id}@overview.test`,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(prisma);
    await app.close();
  });

  /** 签一张指定 status 的 token（createAccessToken 固定写 active）。 */
  async function signWithStatus(
    userId: string,
    status: string,
  ): Promise<string> {
    const jwtCfg = configService.getOrThrow<{
      accessSecret: string;
      accessTtl: number;
      issuer: string;
      audience: string;
    }>(ConfigKey.Jwt);
    return jwtService.signAsync(
      { sub: userId, email: `${userId}@overview.test`, status },
      {
        secret: jwtCfg.accessSecret,
        expiresIn: jwtCfg.accessTtl,
        issuer: jwtCfg.issuer,
        audience: jwtCfg.audience,
      },
    );
  }

  async function get(
    userId?: string,
  ): Promise<{ status: number; body: OverviewBody }> {
    const response = await request(app.getHttpServer())
      .get(OVERVIEW_PATH)
      .set(AUTH_HEADER, bearer(token));

    // userId 参数只用于读断言便利，实际身份永远来自 token。
    void userId;
    return { status: response.status, body: response.body as OverviewBody };
  }

  it('requires authentication', async () => {
    // 与其余 /medicines/* 不同：这里涉及用户自己的用药集合，必须登录。
    await request(app.getHttpServer()).get(OVERVIEW_PATH).expect(401);
  });

  it('returns zeroed aggregates when the user has no medicines', async () => {
    // 「没在吃药」是有效答案而不是错误：空聚合让客户端直接渲染空状态，
    // 不必区分 404 与「没有数据」。
    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body).toEqual({
      totalMedicines: 0,
      resolvableMedicines: 0,
      duplicates: [],
      sourceOverlaps: [],
    });
  });

  it('counts an unresolvable medicine without failing the whole request', async () => {
    // 手动录入 / CN 源可能查不到详情。这类条目必须计入 total 但不进
    // resolvable，而不是让整个端点 500。
    await prisma.userCurrentMedicine.create({
      data: {
        userId: user.id,
        source: MedicineSource.manual,
        displayName: 'Manual entry',
        isCurrent: true,
      },
    });

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.totalMedicines).toBe(1);
    expect(body.resolvableMedicines).toBe(0);
    expect(body.duplicates).toEqual([]);
    // 没有关联健康事件的条目归入 unattributed。
    expect(body.sourceOverlaps).toEqual([
      {
        source: 'unattributed',
        medicineCount: 1,
        displayNames: ['Manual entry'],
      },
    ]);
  });

  it("never exposes another user's medicines", async () => {
    // 身份只来自 token：没有任何参数能让调用方读到别人的集合。
    const other = await createTestUser(prisma, undefined, 'OtherUser');
    await prisma.userCurrentMedicine.create({
      data: {
        userId: other.id,
        source: MedicineSource.manual,
        displayName: 'Other user medicine',
        isCurrent: true,
      },
    });

    const { status, body } = await get(other.id);

    expect(status).toBe(200);
    // 只看到自己的那一条，别人的不会出现。
    expect(body.totalMedicines).toBe(1);
    expect(body.sourceOverlaps[0]?.displayNames).not.toContain(
      'Other user medicine',
    );
  });

  it('groups medicines by the health event that links them', async () => {
    // 有事件关联的条目按事件分组；这是全景区别于条目列表的关键——
    // 它回答「这几个药是同一个病程开的，还是不同时期自己加的」。
    const event = await prisma.healthEvent.create({
      data: {
        userId: user.id,
        title: 'Flu',
        kind: HealthEventKind.symptom,
        startedAt: new Date('2026-10-01'),
      },
    });
    const linked = await prisma.userCurrentMedicine.create({
      data: {
        userId: user.id,
        source: MedicineSource.manual,
        displayName: 'Linked medicine',
        isCurrent: true,
      },
    });
    await prisma.healthEventMedicine.create({
      data: { eventId: event.id, currentMedicineId: linked.id },
    });

    const { body } = await get();

    const linkedGroup = body.sourceOverlaps.find(
      (group) => group.source === event.id,
    );
    expect(linkedGroup).toMatchObject({
      medicineCount: 1,
      displayNames: ['Linked medicine'],
    });
    // 未关联的那条仍在 unattributed 里。
    expect(
      body.sourceOverlaps.some((group) => group.source === 'unattributed'),
    ).toBe(true);
  });

  it('ignores medicines that are no longer current', async () => {
    // 软删（isCurrent=false）的药不该出现在全景里——否则「我以前吃过」会被
    // 当成「我现在在吃」。
    await prisma.userCurrentMedicine.updateMany({
      where: { userId: user.id },
      data: { isCurrent: false },
    });

    const { body } = await get();

    expect(body.totalMedicines).toBe(0);
  });

  it('rejects a token issued for a suspended account', async () => {
    // `JwtAccessStrategy.validate` 校验的是 **token 载荷里的 status**，不查库。
    // 所以停用只影响之后签发的 token——已签发的那张在过期前仍然可用。
    // 这里签一张 status=suspended 的 token 来钉住守卫行为。
    const suspendedUser = await createTestUser(
      prisma,
      undefined,
      'SuspendedUser',
    );
    const suspendedToken = await signWithStatus(suspendedUser.id, 'suspended');

    await request(app.getHttpServer())
      .get(OVERVIEW_PATH)
      .set(AUTH_HEADER, bearer(suspendedToken))
      .expect(401);
  });
});
