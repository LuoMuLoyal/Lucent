import request from 'supertest';

import type { ApiEnvelope } from '../../../src/common';
import { createTestApp, expectData } from '../../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp } from '../../helpers/e2e-helpers';

const BASE_PATH = '/api/v1/legal-documents';

interface ListItem {
  docType: string;
  title: string;
  updatedAt: string;
}

interface ListData {
  items: ListItem[];
  updatedAt: string;
}

interface DetailData {
  docType: string;
  title: string;
  content: string;
  updatedAt: string;
}

describe('Legal Documents API (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;

  const testDocs = [
    {
      docType: 'terms',
      titleZh: '用户协议',
      titleEn: 'Terms of Service',
      contentZh: '# 用户协议\n\n请仔细阅读。',
      contentEn: '# Terms of Service\n\nPlease read carefully.',
      isActive: true,
    },
    {
      docType: 'privacy',
      titleZh: '隐私政策',
      titleEn: 'Privacy Policy',
      contentZh: '# 隐私政策\n\n我们保护您的隐私。',
      contentEn: '# Privacy Policy\n\nWe protect your privacy.',
      isActive: true,
    },
    {
      docType: 'disclaimer',
      titleZh: '医疗免责声明',
      titleEn: 'Medical Disclaimer',
      contentZh: '# 医疗免责声明',
      contentEn: '# Medical Disclaimer',
      isActive: false,
    },
  ];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;

    // Clean up any existing legal documents and insert test data
    await ctx.prisma.legalDocument.deleteMany({});
    for (const doc of testDocs) {
      await ctx.prisma.legalDocument.create({ data: doc });
    }
  });

  afterAll(async () => {
    await ctx.prisma.legalDocument.deleteMany({});
    await app.close();
  });

  describe('GET /api/v1/legal-documents', () => {
    it('should return active documents with Chinese titles by default', async () => {
      const response = await request(app.getHttpServer())
        .get(BASE_PATH)
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<ListData>);
      expect(data.items).toHaveLength(2);
      const docTypes = data.items.map((i) => i.docType).sort();
      expect(docTypes).toEqual(['privacy', 'terms']);
      const termsItem = data.items.find((i) => i.docType === 'terms')!;
      expect(termsItem.title).toBe('用户协议');
    });

    it('should return active documents with English titles when lang=en', async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE_PATH}?lang=en`)
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<ListData>);
      expect(data.items).toHaveLength(2);
      const termsItem = data.items.find((i) => i.docType === 'terms')!;
      expect(termsItem.title).toBe('Terms of Service');
    });

    it('should not include inactive documents', async () => {
      const response = await request(app.getHttpServer())
        .get(BASE_PATH)
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<ListData>);
      expect(
        data.items.find((i) => i.docType === 'disclaimer'),
      ).toBeUndefined();
    });

    it('should return updatedAt timestamp', async () => {
      const response = await request(app.getHttpServer())
        .get(BASE_PATH)
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<ListData>);
      expect(data.updatedAt).toBeTruthy();
    });

    it('should reject invalid lang parameter', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}?lang=fr`)
        .expect(400);
    });
  });

  describe('GET /api/v1/legal-documents/:docType', () => {
    it('should return Chinese content by default', async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE_PATH}/terms`)
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<DetailData>);
      expect(data.docType).toBe('terms');
      expect(data.title).toBe('用户协议');
      expect(data.content).toContain('用户协议');
      expect(data.updatedAt).toBeTruthy();
    });

    it('should return English content when lang=en', async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE_PATH}/terms?lang=en`)
        .expect(200);

      const data = expectData(response.body as ApiEnvelope<DetailData>);
      expect(data.title).toBe('Terms of Service');
      expect(data.content).toContain('Terms of Service');
    });

    it('should return 404 for unknown docType', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/nonexistent`)
        .expect(404);
    });

    it('should return 404 for inactive documents', async () => {
      await request(app.getHttpServer())
        .get(`${BASE_PATH}/disclaimer`)
        .expect(404);
    });
  });
});
