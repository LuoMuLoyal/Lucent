import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/setup-app';
import type { ApiEnvelope } from '../../../src/common/api-envelope';
import { ResultCode } from '../../../src/common/api-envelope';
import { PrismaService } from '../../../src/prisma/prisma.service';

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

interface MedicineSearchMeta {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface MedicineDetailData {
  id: string;
  source: 'drugbank' | 'cn';
  name: string;
  subtitle: string | null;
  detail: Record<string, unknown>;
}

const MEDICINES_PATH = '/api/v1/medicines';

function expectData<T>(body: ApiEnvelope<T>): T {
  expect(body.data).not.toBeNull();
  return body.data as T;
}

describe('Medicines API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app, app.get(ConfigService));
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.drugbankDrugTarget.deleteMany();
    await prisma.drugbankExternalLink.deleteMany();
    await prisma.drugbankTarget.deleteMany();
    await prisma.drugbankDrug.deleteMany();
    await prisma.cnMedicineProduct.deleteMany();
    await prisma.drugSourceImport.deleteMany();
  });

  afterAll(async () => {
    await prisma.drugbankDrugTarget.deleteMany();
    await prisma.drugbankExternalLink.deleteMany();
    await prisma.drugbankTarget.deleteMany();
    await prisma.drugbankDrug.deleteMany();
    await prisma.cnMedicineProduct.deleteMany();
    await prisma.drugSourceImport.deleteMany();
    await app.close();
  });

  beforeEach(async () => {
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

    const body = response.body as ApiEnvelope<MedicineSearchItem[]> & {
      meta: MedicineSearchMeta;
    };
    expect(body.code).toBe(ResultCode.SUCCESS);
    expect(body.meta.pagination).toEqual({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });

    const data = expectData(body);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: 'DB01050',
      source: 'drugbank',
      name: 'Ibuprofen',
      subtitle: 'CAS 15687-27-1 / approved / small molecule',
    });
    expect(data[0]?.matchedBy).toContain('name');
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

    const body = response.body as ApiEnvelope<MedicineSearchItem[]> & {
      meta: MedicineSearchMeta;
    };
    expect(body.code).toBe(ResultCode.SUCCESS);

    const data = expectData(body);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
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

    const body = response.body as ApiEnvelope<MedicineDetailData>;
    expect(body.code).toBe(ResultCode.SUCCESS);

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

    const body = response.body as ApiEnvelope;
    expect(body.code).toBe(ResultCode.BAD_REQUEST);
    expect(body.message).toBe('Invalid medicine source');
  });
});
