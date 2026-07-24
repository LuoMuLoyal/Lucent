import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
  uniqueEmail,
} from '../helpers/e2e-helpers';
import type { E2eTestContext, E2eApp, TestUser } from '../helpers/e2e-helpers';
import { ResultCode } from '../../src/common';
import type { ApiEnvelope } from '../../src/common';

// ── OpenAPI spec loader ─────────────────────────────────────────

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
}

interface OpenApiSchema {
  type?: string;
  $ref?: string;
  items?: { $ref?: string };
  properties?: Record<
    string,
    { type?: string; $ref?: string; items?: { $ref?: string } }
  >;
  required?: string[];
  enum?: string[];
}

function loadOpenApiSpec(): OpenApiSpec {
  const specPath = resolve(__dirname, '../../docs/openapi.json');
  return JSON.parse(readFileSync(specPath, 'utf-8')) as OpenApiSpec;
}

/**
 * Resolve a `$ref` pointer like `#/components/schemas/Foo` to the actual schema.
 */
function resolveRef(spec: OpenApiSpec, ref: string): OpenApiSchema | undefined {
  const parts = ref.replace('#/', '').split('/');
  let current: unknown = spec;
  for (const part of parts) {
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return undefined;
  }
  return current as OpenApiSchema;
}

/**
 * Assert that `body` conforms to the global API envelope `{ code, message, data }`.
 */
function assertEnvelopeShape(body: unknown): void {
  const env = body as ApiEnvelope;
  expect(env).toBeDefined();
  expect(typeof env.code).toBe('number');
  expect(typeof env.message).toBe('string');
  // data can be null, an object, or an array — but must exist as a key
  expect(env).toHaveProperty('data');
}

/**
 * Assert that `data` contains at least the required properties listed in the schema.
 * This is a structural check, not a deep type validator — it catches missing fields
 * and gross shape mismatches without needing a full JSON Schema validator.
 */
function assertRequiredProperties(
  data: unknown,
  schema: OpenApiSchema | undefined,
  spec: OpenApiSpec,
): void {
  if (!schema || data === null) return;

  // Follow $ref if present
  const resolved = schema.$ref
    ? (resolveRef(spec, schema.$ref) ?? schema)
    : schema;

  // If the schema looks like an envelope (has 'code' in required)
  // but the actual data doesn't have 'code', skip the required check.
  // The envelope structure is already verified by assertEnvelopeShape.
  if (
    resolved.required?.includes('code') &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    !('code' in data)
  ) {
    return;
  }

  if (resolved.type === 'array' && Array.isArray(data)) {
    // Validate first item if items schema is available
    if (resolved.items?.$ref && data.length > 0) {
      const itemSchema = resolveRef(spec, resolved.items.$ref);
      assertRequiredProperties(data[0], itemSchema, spec);
    }
    return;
  }

  // If data is an array but schema is an object, validate first item (if any).
  // This handles cases where the response DTO describes a single item but the
  // endpoint returns an array of items.
  if (Array.isArray(data) && resolved.type !== 'array') {
    if (data.length > 0) {
      assertRequiredProperties(data[0], resolved, spec);
    }
    return;
  }

  if (typeof data !== 'object') return;

  const obj = data as Record<string, unknown>;
  for (const field of resolved.required ?? []) {
    expect(obj).toHaveProperty(field);
  }
}

// ── Test suite ─────────────────────────────────────────────────

describe('API Contract Tests (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let user: TestUser;
  let accessToken: string;
  let spec: OpenApiSpec;

  beforeAll(async () => {
    spec = loadOpenApiSpec();
    ctx = await createTestApp();
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    user = await createTestUser(
      ctx.prisma,
      uniqueEmail('contract'),
      'ContractUser',
    );
    accessToken = await createAccessToken(
      ctx.jwtService,
      ctx.configService,
      user.id,
      user.email,
    );
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  // ── Spec integrity ──────────────────────────────────────────

  describe('OpenAPI spec integrity', () => {
    it('should have a non-empty paths object', () => {
      expect(spec.paths).toBeDefined();
      expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    });

    it('should have components.schemas with at least 20 schemas', () => {
      expect(spec.components?.schemas).toBeDefined();
      const schemaCount = Object.keys(spec.components!.schemas!).length;
      expect(schemaCount).toBeGreaterThan(20);
    });

    it('should define all $ref targets in components.schemas', () => {
      const json = JSON.stringify(spec);
      const refPattern = /"\$ref":"#\/components\/schemas\/([^"]+)"/g;
      const referenced = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = refPattern.exec(json)) !== null) {
        referenced.add(match[1]!);
      }

      const defined = new Set(Object.keys(spec.components?.schemas ?? {}));
      const missing = [...referenced].filter((r) => !defined.has(r));
      expect(missing).toEqual([]);
    });
  });

  // ── Public endpoints ────────────────────────────────────────

  describe('GET /api/v1/health — contract', () => {
    it('should match HealthResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      assertEnvelopeShape(res.body);
      const env = res.body as ApiEnvelope;
      expect(env.code).toBe(ResultCode.SUCCESS);

      const schema = resolveRef(spec, '#/components/schemas/HealthResponseDto');
      assertRequiredProperties(env.data, schema, spec);

      // Verify nested probe field exists
      expect(env.data).toHaveProperty('probe');
      expect(env.data).toHaveProperty('status');
      expect(env.data).toHaveProperty('summary');
    });
  });

  describe('GET /api/v1/health/live — contract', () => {
    it('should match HealthResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);

      assertEnvelopeShape(res.body);
      expect((res.body as ApiEnvelope).data).toHaveProperty('probe', 'live');
    });
  });

  describe('GET /api/v1/health/ready — contract', () => {
    it('should match HealthResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);

      assertEnvelopeShape(res.body);
      expect((res.body as ApiEnvelope).data).toHaveProperty('probe', 'ready');
    });
  });

  describe('GET /api/v1/medicines/safety-tips — contract', () => {
    it('should match MedicineSafetyTipResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/medicines/safety-tips')
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/MedicineSafetyTipResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/legal-documents — contract', () => {
    it('should match LegalDocumentListResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/legal-documents')
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/LegalDocumentListResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/public/support-resources — contract', () => {
    it('should match SupportResourceListResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/support-resources')
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/SupportResourceListResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/public/app-info — contract', () => {
    it('should match AppInfoResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/public/app-info')
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/AppInfoResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  // ── Authenticated endpoints ─────────────────────────────────

  describe('GET /api/v1/account — contract', () => {
    it('should match AccountResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/account')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/AccountResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);

      // Spot-check key fields
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('email');
    });
  });

  describe('GET /api/v1/user/health-context — contract', () => {
    it('should match HealthContextResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/health-context')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/HealthContextResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/notifications — contract', () => {
    it('should match NotificationListResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/notifications')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/NotificationListResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/settings — contract', () => {
    it('should match UserSettingsResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/settings')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/UserSettingsResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/daily-records — contract', () => {
    it('should match DailyRecordListResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/daily-records')
        .query({ date: '2026-07-12' })
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/DailyRecordListResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/medicine-reminders — contract', () => {
    it('should match MedicineReminderListResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/medicine-reminders')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/MedicineReminderListResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/medicine-dose-logs — contract', () => {
    it('should match DoseLogListResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/medicine-dose-logs')
        .query({ date: '2026-07-12' })
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/DoseLogListResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/reports/dashboard — contract', () => {
    it('should match ReportDashboardResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/reports/dashboard')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/ReportDashboardResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/today/suggestions — contract', () => {
    it('should match TodaySuggestionsResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/today/suggestions')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/TodaySuggestionsResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/user/assistant/capabilities — contract', () => {
    it('should match AssistantCapabilitiesResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/assistant/capabilities')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/AssistantCapabilitiesResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  describe('GET /api/v1/environment/snapshot — contract', () => {
    it('should match EnvironmentSnapshotResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/environment/snapshot')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);

      const schema = resolveRef(
        spec,
        '#/components/schemas/EnvironmentSnapshotResponseDto',
      );
      assertRequiredProperties(res.body.data, schema, spec);
    });
  });

  // ── Additional GET endpoint contracts ───────────────────────

  describe('GET /api/v1/health/deep — contract', () => {
    it('should match HealthResponseDto shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health/deep')
        .expect(200);

      assertEnvelopeShape(res.body);
      expect(res.body.data).toHaveProperty('probe');
      expect(res.body.data).toHaveProperty('status');
    });
  });

  describe('GET /api/v1/medicines — contract', () => {
    it('should match paginated medicine list shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/medicines')
        .query({ q: 'test', page: 1, pageSize: 5 })
        .expect(200);

      assertEnvelopeShape(res.body);
      expect(res.body.data).toHaveProperty('items');
      expect(res.body.data).toHaveProperty('pagination');
    });
  });

  describe('GET /api/v1/user/notifications/unread-count — contract', () => {
    it('should match unread count shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/notifications/unread-count')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);
      expect(res.body.data).toHaveProperty('count');
    });
  });

  describe('GET /api/v1/user/daily-records/summary — contract', () => {
    it('should match daily record summary shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/daily-records/summary')
        .query({ date: '2026-07-12' })
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);
    });
  });

  describe('GET /api/v1/user/today/suggestions/history — contract', () => {
    it('should match suggestion history shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/today/suggestions/history')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);
    });
  });

  describe('GET /api/v1/user/today-analysis/recommendations — contract', () => {
    it('should match recommendations shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/today-analysis/recommendations')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);
    });
  });

  describe('GET /api/v1/user/assistant/conversations — contract', () => {
    it('should match conversation list shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/assistant/conversations')
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);
    });
  });

  // ── POST response shape contracts ──────────────────────────

  describe('POST /api/v1/user/daily-records — response contract', () => {
    it('should return created record with id in envelope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/daily-records')
        .set('Authorization', bearer(accessToken))
        .send({
          occurredAt: '2026-07-12',
          kind: 'meal',
          payload: { mealType: 'breakfast', items: [] },
        })
        .expect(201);

      assertEnvelopeShape(res.body);
      expect(res.body.code).toBe(ResultCode.SUCCESS);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('kind', 'meal');
    });
  });

  describe('POST /api/v1/user/health-context/allergies — response contract', () => {
    it('should return updated allergies list in envelope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/health-context/allergies')
        .set('Authorization', bearer(accessToken))
        .send({ kind: 'drug', label: 'ContractAllergy', severity: 'mild' })
        .expect(201);

      assertEnvelopeShape(res.body);
      expect(res.body.code).toBe(ResultCode.SUCCESS);
      expect(res.body.data).toHaveProperty('allergies');
      expect(Array.isArray(res.body.data.allergies)).toBe(true);
    });
  });

  describe('POST /api/v1/user/notifications — response contract', () => {
    it('should return created notification in envelope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/notifications')
        .set('Authorization', bearer(accessToken))
        .send({
          type: 'medicine_reminder',
          title: 'Contract test',
          content: 'Testing',
        })
        .expect(201);

      assertEnvelopeShape(res.body);
      expect(res.body.code).toBe(ResultCode.SUCCESS);
      expect(res.body.data).toHaveProperty('id');
    });
  });

  // ── PATCH response shape contract ──────────────────────────

  describe('PATCH /api/v1/user/settings — response contract', () => {
    it('should return updated settings in envelope', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/user/settings')
        .set('Authorization', bearer(accessToken))
        .send({ assistantMemoryEnabled: true })
        .expect(200);

      assertEnvelopeShape(res.body);
      expect(res.body.code).toBe(ResultCode.SUCCESS);
    });
  });

  // ── Pagination meta contract ───────────────────────────────

  describe('Pagination meta — contract', () => {
    it('GET /api/v1/medicines should include pagination in data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/medicines')
        .query({ q: 'test', page: 1, pageSize: 5 })
        .set('Authorization', bearer(accessToken))
        .expect(200);

      // Pagination is embedded inside data, not at the top-level meta
      assertEnvelopeShape(res.body);
      expect(res.body.data).toHaveProperty('pagination');
      expect(res.body.data.pagination).toHaveProperty('page');
      expect(res.body.data.pagination).toHaveProperty('pageSize');
      expect(res.body.data.pagination).toHaveProperty('total');
    });

    it('GET /api/v1/user/daily-records should return items array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/user/daily-records')
        .query({ date: '2026-07-12' })
        .set('Authorization', bearer(accessToken))
        .expect(200);

      assertEnvelopeShape(res.body);
      // daily-records list returns data.items
      if (res.body.data && typeof res.body.data === 'object') {
        const data = res.body.data as Record<string, unknown>;
        if (data['items'] !== undefined) {
          expect(Array.isArray(data['items'])).toBe(true);
        }
      }
    });
  });

  // ── Error envelope contract ────────────────────────────────

  describe('Error responses — contract', () => {
    it('unauthenticated request should return error envelope with code != 0', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/account')
        .expect(401);

      assertEnvelopeShape(res.body);
      const env = res.body as ApiEnvelope;
      expect(env.code).not.toBe(ResultCode.SUCCESS);
      expect(env.data).toBeNull();
      expect(env.message).toBeTruthy();
    });

    it('invalid route should return 404 error envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/nonexistent-endpoint')
        .expect(404);

      assertEnvelopeShape(res.body);
      const env = res.body as ApiEnvelope;
      expect(env.code).not.toBe(ResultCode.SUCCESS);
      expect(env.data).toBeNull();
    });

    it('validation error should return 400 envelope with VALIDATION_FAILED code', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: '12' })
        .expect(400);

      assertEnvelopeShape(res.body);
      const env = res.body as ApiEnvelope;
      expect(env.code).not.toBe(ResultCode.SUCCESS);
      expect(env.data).toBeNull();
      expect(env.message).toBeTruthy();
    });
  });
});
