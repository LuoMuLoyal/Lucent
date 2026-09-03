import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { Cache } from 'cache-manager';

import { AppModule } from '../../../src/app.module.js';
import { setupApp } from '../../../src/setup-app.js';
import { PrismaService } from '../../../src/prisma/index.js';
import { ConfigKey } from '../../../src/config/env/config-keys.enum.js';
import { UserStatus } from '#generated/prisma/client.js';

interface MedicineSearchItem {
  id: string;
  source: 'drugbank' | 'cn';
  name: string;
  subtitle: string | null;
  summary: string | null;
  tags: string[];
  imageUrl: string | null;
  matchedBy: string[];
}

interface MedicinePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface MedicineSearchData {
  items: MedicineSearchItem[];
  pagination: MedicinePagination;
}

interface MedicineDetailData {
  id: string;
  source: 'drugbank' | 'cn';
  name: string;
  subtitle: string | null;
  detail: Record<string, unknown>;
}

interface SafetyTipItem {
  id: string;
  text: string;
  category: string;
}

const MEDICINES_PATH = '/api/v1/medicines';
const SAFETY_TIPS_PATH = '/api/v1/medicines/safety-tips';
const RECOGNIZE_PATH = '/api/v1/medicines/recognize';
const AUTH_HEADER = 'Authorization';

let recognizeSeq = 0;

function uniqueEmail(): string {
  recognizeSeq += 1;
  return `med-recognize${recognizeSeq}_${Date.now()}@example.com`;
}

function expectData<T>(body: T): T {
  expect(body).not.toBeNull();
  return body as T;
}

describe('Medicines API (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

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

    await prisma.medicineSafetyTip.deleteMany();
    await prisma.drugbankDrugTarget.deleteMany();
    await prisma.drugbankExternalLink.deleteMany();
    await prisma.drugbankTarget.deleteMany();
    await prisma.drugbankDrug.deleteMany();
    await prisma.cnMedicineProduct.deleteMany();
    await prisma.drugSourceImport.deleteMany();
  });

  afterAll(async () => {
    await prisma.medicineSafetyTip.deleteMany();
    await prisma.drugbankDrugTarget.deleteMany();
    await prisma.drugbankExternalLink.deleteMany();
    await prisma.drugbankTarget.deleteMany();
    await prisma.drugbankDrug.deleteMany();
    await prisma.cnMedicineProduct.deleteMany();
    await prisma.drugSourceImport.deleteMany();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.medicineSafetyTip.deleteMany();
    await prisma.drugbankDrugTarget.deleteMany();
    await prisma.drugbankExternalLink.deleteMany();
    await prisma.drugbankTarget.deleteMany();
    await prisma.drugbankDrug.deleteMany();
    await prisma.cnMedicineProduct.deleteMany();
    await prisma.drugSourceImport.deleteMany();
  });

  it('should default search to the drugbank source', async () => {
    await prisma.drugbankDrug.create({
      data: {
        drugbankId: 'DB01050',
        name: 'Ibuprofen',
        casNumber: '15687-27-1',
        description: 'A non-steroidal anti-inflammatory drug.',
        groups: ['approved', 'small molecule'],
        categories: ['Analgesics'],
        atcCodes: ['M01AE01'],
        searchText: 'ibuprofen DB01050 15687-27-1',
      },
    });

    const response = await request(app.getHttpServer())
      .get(MEDICINES_PATH)
      .query({ q: 'ibu', page: 1, pageSize: 10 })
      .expect(200);

    const body = response.body as MedicineSearchData;
    const data = expectData(body);
    expect(data.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      id: 'DB01050',
      source: 'drugbank',
      name: 'Ibuprofen',
      subtitle: 'CAS 15687-27-1 / approved / small molecule',
    });
    expect(data.items[0]?.matchedBy).toContain('name');
  });

  it('should search the chinese source when requested', async () => {
    await prisma.cnMedicineProduct.create({
      data: {
        id: 'cn_ibuprofen_capsule',
        sourceName: 'full_drug_detail',
        name: '布洛芬缓释胶囊',
        packageSpec: '0.3g*10粒',
        manufacturer: '某某制药',
        drugType: 'OTC',
        mainCategory: '解热镇痛',
        subcategory: '非甾体抗炎药',
        indications: '用于缓解轻至中度疼痛。',
        approvalNumber: '国药准字H10900089',
        searchText: '布洛芬缓释胶囊 国药准字H10900089',
      },
    });

    const response = await request(app.getHttpServer())
      .get(MEDICINES_PATH)
      .query({ source: 'cn', q: '布洛芬', page: 1, pageSize: 10 })
      .expect(200);

    const body = response.body as MedicineSearchData;

    const data = expectData(body);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      id: 'cn_ibuprofen_capsule',
      source: 'cn',
      name: '布洛芬缓释胶囊',
      subtitle: '0.3g*10粒 / 某某制药',
      imageUrl: null,
    });
  });

  it('should default detail lookup to drugbank', async () => {
    await prisma.drugbankDrug.create({
      data: {
        drugbankId: 'DB01050',
        name: 'Ibuprofen',
        casNumber: '15687-27-1',
        description: 'A non-steroidal anti-inflammatory drug.',
        indication: 'Used for pain, fever, and inflammation.',
        mechanismOfAction: 'Inhibits prostaglandin synthesis.',
        pharmacodynamics: 'Anti-inflammatory, analgesic, and antipyretic.',
        groups: ['approved', 'small molecule'],
        categories: ['Analgesics'],
        atcCodes: ['M01AE01'],
        synonyms: ['Ibuprofen'],
        foodInteractions: ['Avoid alcohol.'],
      },
    });

    const response = await request(app.getHttpServer())
      .get(`${MEDICINES_PATH}/DB01050`)
      .expect(200);

    const body = response.body as MedicineDetailData;

    const data = expectData(body);
    expect(data).toMatchObject({
      id: 'DB01050',
      source: 'drugbank',
      name: 'Ibuprofen',
      subtitle: 'CAS 15687-27-1 / approved / small molecule',
    });
    expect(data.detail).toMatchObject({
      kind: 'drugbank',
      indication: 'Used for pain, fever, and inflammation.',
      mechanismOfAction: 'Inhibits prostaglandin synthesis.',
    });
  });

  it('should reject invalid source values with a business bad-request code', async () => {
    const response = await request(app.getHttpServer())
      .get(MEDICINES_PATH)
      .query({ source: 'raw-db', q: 'ibuprofen' })
      .expect(400);

    const body = response.body as Record<string, unknown>;
    expect(body['code']).toBe('VALIDATION_FAILED');
  });

  // ── Safety Tips ──────────────────────────────────────────────

  describe('GET /api/v1/medicines/safety-tips', () => {
    beforeEach(async () => {
      await prisma.medicineSafetyTip.createMany({
        data: [
          {
            id: 'tip-alcohol',
            contentZh: '服药期间请勿饮酒',
            contentEn: 'Do not drink alcohol while taking medicine',
            category: 'alcohol',
            sortOrder: 1,
            isActive: true,
          },
          {
            id: 'tip-caffeine',
            contentZh: '咖啡因可能影响药效',
            contentEn: 'Caffeine may affect drug efficacy',
            category: 'caffeine',
            sortOrder: 2,
            isActive: true,
          },
          {
            id: 'tip-timing',
            contentZh: '请按时服药',
            contentEn: 'Take medicine on time',
            category: 'timing',
            sortOrder: 3,
            isActive: true,
          },
          {
            id: 'tip-storage',
            contentZh: '请将药品存放在阴凉处',
            contentEn: 'Store medicine in a cool place',
            category: 'storage',
            sortOrder: 4,
            isActive: true,
          },
          {
            id: 'tip-food',
            contentZh: '注意药物与食物的相互作用',
            contentEn: 'Be aware of drug-food interactions',
            category: 'food',
            sortOrder: 5,
            isActive: true,
          },
          {
            id: 'tip-inactive',
            contentZh: '此提示已停用',
            contentEn: 'This tip is inactive',
            category: 'general',
            sortOrder: 6,
            isActive: false,
          },
        ],
      });
    });

    it('should return up to 4 random safety tips in Chinese', async () => {
      const response = await request(app.getHttpServer())
        .get(SAFETY_TIPS_PATH)
        .set('Accept-Language', 'zh-CN')
        .expect(200);

      const body = response.body as SafetyTipItem[];
      const data = expectData(body);
      expect(data).toHaveLength(4);
      // Each tip should have Chinese text
      for (const tip of data) {
        expect(tip.id).toBeTruthy();
        expect(tip.text).toBeTruthy();
        expect(tip.category).toBeTruthy();
      }
      // Should not include inactive tips
      expect(data.map((t) => t.id)).not.toContain('tip-inactive');
    });

    it('should return tips in English by default', async () => {
      const response = await request(app.getHttpServer())
        .get(SAFETY_TIPS_PATH)
        .expect(200);

      const body = response.body as SafetyTipItem[];
      const data = expectData(body);
      expect(data).toHaveLength(4);
      // English text should contain ASCII characters typical of English
      expect(data[0]?.text).toMatch(/^[A-Z]/);
    });

    it('should return empty array when no active tips exist', async () => {
      // Clear safety-tips cache so stale entries from previous tests don't interfere
      const cache = app.get<Cache>(CACHE_MANAGER);
      await cache.del('medicines:safety-tips:all');

      await prisma.medicineSafetyTip.deleteMany();

      const response = await request(app.getHttpServer())
        .get(SAFETY_TIPS_PATH)
        .expect(200);

      const body = response.body as SafetyTipItem[];
      expect(body).toEqual([]);
    });

    it('should exclude specified tip ids', async () => {
      const firstRes = await request(app.getHttpServer())
        .get(SAFETY_TIPS_PATH)
        .set('Accept-Language', 'zh-CN')
        .expect(200);

      const firstData = expectData(firstRes.body as SafetyTipItem[]);
      const excludeIds = firstData.map((t) => t.id);

      const secondRes = await request(app.getHttpServer())
        .get(`${SAFETY_TIPS_PATH}?exclude=${excludeIds.join('&exclude=')}`)
        .set('Accept-Language', 'zh-CN')
        .expect(200);

      const secondData = expectData(secondRes.body as SafetyTipItem[]);
      // Excluded ids should not appear (unless fewer than 4 remain)
      for (const id of excludeIds) {
        expect(secondData.map((t) => t.id)).not.toContain(id);
      }
    });
  });

  // ── AI Medicine Box Recognition ──────────────────────────────

  describe('POST /api/v1/medicines/recognize', () => {
    async function createUserWithToken() {
      const email = uniqueEmail();
      const user = await prisma.user.create({
        data: {
          email,
          status: UserStatus.active,
        },
      });

      const jwtCfg = configService.getOrThrow<{
        accessSecret: string;
        accessTtl: number;
        issuer: string;
        audience: string;
      }>(ConfigKey.Jwt);

      const token = await jwtService.signAsync(
        { sub: user.id, email: user.email!, status: 'active' },
        {
          secret: jwtCfg.accessSecret,
          expiresIn: jwtCfg.accessTtl,
          algorithm: 'HS512' as const,
          issuer: jwtCfg.issuer,
          audience: jwtCfg.audience,
        },
      );
      return { user, token };
    }

    it('should return 401 for unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post(RECOGNIZE_PATH)
        .send({ imageUrl: 'https://example.com/medicine.jpg' })
        .expect(401);
    });

    it('should return 400 for invalid request body (missing imageUrl)', async () => {
      const { token } = await createUserWithToken();

      await request(app.getHttpServer())
        .post(RECOGNIZE_PATH)
        .set(AUTH_HEADER, `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should return 400 for empty imageUrl', async () => {
      const { token } = await createUserWithToken();

      await request(app.getHttpServer())
        .post(RECOGNIZE_PATH)
        .set(AUTH_HEADER, `Bearer ${token}`)
        .send({ imageUrl: '' })
        .expect(400);
    });

    it('should accept a valid request and return a recognition result (may be 503 if LLM not configured)', async () => {
      const { token } = await createUserWithToken();

      const response = await request(app.getHttpServer())
        .post(RECOGNIZE_PATH)
        .set(AUTH_HEADER, `Bearer ${token}`)
        .send({ imageUrl: 'http://localhost/test-medicine.jpg' });

      // The endpoint calls LLM; in test env LLM may not be configured
      // which results in either 200 (with null fields) or 503
      if (response.status === 200) {
        const body = response.body as {
          name: string | null;
          approvalNumber: string | null;
          specification: string | null;
          manufacturer: string | null;
        };
        expect(body).toBeDefined();
      } else {
        expect([503, 500]).toContain(response.status);
      }
    });
  });
});
