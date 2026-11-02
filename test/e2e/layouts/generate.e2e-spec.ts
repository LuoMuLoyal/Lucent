import request from 'supertest';

import {
  createTestApp,
  cleanupDatabase,
  createTestUser,
  createAccessToken,
  bearer,
} from '../../helpers/e2e-helpers.js';
import type {
  E2eTestContext,
  E2eApp,
  TestModuleOverride,
} from '../../helpers/e2e-helpers.js';
import { SURFACE_GENERATOR } from '../../../src/modules/layouts/application/ports/surface-generator.js';
import type {
  SurfaceGenerator,
  SurfaceGenerationContext,
  SurfaceGenerationOutput,
} from '../../../src/modules/layouts/application/ports/surface-generator.js';

const GENERATE_PATH = (surface: string) =>
  `/api/v1/layouts/${surface}/generate`;

/** A tree the admission policy accepts. */
const VALID_MESSAGES = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'generative-review',
      catalogId: 'com.luminous.generative',
      sendDataModel: false,
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'generative-review',
      components: [
        { id: 'root', component: 'Column', children: ['title'] },
        { id: 'title', component: 'Text', text: 'This week' },
      ],
    },
  },
];

/**
 * Stands in for the LLM so the SSE plumbing, admission policy, error mapping
 * and language forwarding are all exercised without a model or network.
 */
class FakeSurfaceGenerator implements SurfaceGenerator {
  configured = true;
  lastContext: SurfaceGenerationContext | undefined;
  output: SurfaceGenerationOutput = {
    summary: 'A compact weekly overview',
    messages: VALID_MESSAGES,
  };
  failure: Error | undefined;

  isConfigured(): boolean {
    return this.configured;
  }

  async generateWithStream(
    context: SurfaceGenerationContext,
    onMessage: (message: Record<string, unknown>) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    this.lastContext = context;
    if (this.failure != null) throw this.failure;

    for (const message of this.output.messages) {
      await onMessage(message);
    }
    return this.output;
  }
}

/**
 * Split an SSE response body into `{ event, data }` frames.
 *
 * supertest buffers the stream into `response.text`, so this parses the wire
 * format the same way a client would — which is the point: if the framing were
 * wrong, the assertions below would fail rather than pass on a substring match.
 */
function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const eventLine = frame
        .split('\n')
        .find((line) => line.startsWith('event: '));
      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data: '));
      return {
        event: eventLine?.slice('event: '.length).trim() ?? '',
        data:
          dataLine == null
            ? undefined
            : JSON.parse(dataLine.slice('data: '.length)),
      };
    });
}

describe('Layouts generate endpoint (e2e)', () => {
  let ctx: E2eTestContext;
  let app: E2eApp;
  let generator: FakeSurfaceGenerator;
  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    generator = new FakeSurfaceGenerator();

    const override: TestModuleOverride = (builder) =>
      builder.overrideProvider(SURFACE_GENERATOR).useValue(generator);

    ctx = await createTestApp([override]);
    app = ctx.app;
    await cleanupDatabase(ctx.prisma);

    const user = await createTestUser(ctx.prisma, undefined, 'GenUiUser');
    userId = user.id;
    userEmail = user.email;
  });

  afterAll(async () => {
    await cleanupDatabase(ctx.prisma);
    await app.close();
  });

  beforeEach(() => {
    generator.configured = true;
    generator.failure = undefined;
    generator.lastContext = undefined;
    generator.output = {
      summary: 'A compact weekly overview',
      messages: VALID_MESSAGES,
    };
  });

  async function token(): Promise<string> {
    return createAccessToken(
      ctx.jwtService,
      ctx.configService,
      userId,
      userEmail,
    );
  }

  // ── Authentication ───────────────────────────────────────────

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .send({ prompt: 'show my water trend' })
      .expect(401);
  });

  // ── SSE happy path ───────────────────────────────────────────

  it('streams chunk events, then result, then done', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show my water trend' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');

    const frames = parseSse(response.text as string);
    const events = frames.map((frame) => frame.event);

    // Exactly the documented sequence: every message chunked, then the final
    // document, then the terminator.
    expect(events).toEqual(['chunk', 'chunk', 'result', 'done']);

    const result = frames.find((frame) => frame.event === 'result')?.data as {
      surface: string;
      messages: unknown[];
      usage: { promptTokens: number; completionTokens: number };
    };
    expect(result.surface).toBe('review');
    expect(result.messages).toHaveLength(VALID_MESSAGES.length);
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  // ── Admission / safety ───────────────────────────────────────

  it('rejects a tree containing a write action', async () => {
    generator.output = {
      summary: 'bad',
      messages: [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'generative-review',
            components: [{ id: 'root', component: 'Button' }],
          },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'add a delete button' })
      .expect(200);

    const frames = parseSse(response.text as string);
    expect(frames.map((f) => f.event)).toContain('error');

    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('GENERATIVE_OUTPUT_REJECTED');
  });

  it('rejects a tree that fabricates a health number', async () => {
    generator.output = {
      summary: 'bad',
      messages: [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'generative-review',
            components: [
              {
                id: 'root',
                component: 'metric_card',
                kind: 'water',
                value: 1800,
              },
            ],
          },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show I drank 1800ml' })
      .expect(200);

    const frames = parseSse(response.text as string);
    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('GENERATIVE_OUTPUT_REJECTED');
  });

  it('rejects a finding that rewrites the backend text', async () => {
    generator.output = {
      summary: 'bad',
      messages: [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'generative-review',
            components: [
              {
                id: 'root',
                component: 'finding',
                findingId: 'f-1',
                title: 'You are sleeping badly',
              },
            ],
          },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'tell me I sleep badly' })
      .expect(200);

    const frames = parseSse(response.text as string);
    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('GENERATIVE_OUTPUT_REJECTED');
  });

  // ── Request boundaries ───────────────────────────────────────

  it('returns 400 GENERATIVE_PROMPT_EMPTY for a blank prompt', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: '   ' })
      .expect(400);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'GENERATIVE_PROMPT_EMPTY',
    );
  });

  it('returns 422 GENERATIVE_PROMPT_TOO_LONG for an oversized prompt', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'a'.repeat(2001) })
      .expect(422);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'GENERATIVE_PROMPT_TOO_LONG',
    );
  });

  it('returns 400 GENERATIVE_SURFACE_UNSUPPORTED for the tab bar', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('tab_chrome'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'rearrange my tabs' })
      .expect(400);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'GENERATIVE_SURFACE_UNSUPPORTED',
    );
  });

  it('returns 400 LAYOUT_SURFACE_UNKNOWN for a surface that does not exist', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('nope'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show something' })
      .expect(400);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'LAYOUT_SURFACE_UNKNOWN',
    );
  });

  it('reports LLM_NOT_CONFIGURED when no model is available', async () => {
    generator.configured = false;

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show my water trend' })
      .expect(200);

    const frames = parseSse(response.text as string);
    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('LLM_NOT_CONFIGURED');
  });

  // ── Language ─────────────────────────────────────────────────

  it('forwards Accept-Language to the generator', async () => {
    await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
      .send({ prompt: '把每日饮水做成三张小卡' })
      .expect(200);

    // The weighted browser header reaches the generator intact; the prompt
    // layer normalises it to a content locale before it meets the model.
    expect(generator.lastContext?.language).toContain('zh');
  });

  it('localizes an HTTP error for zh-CN', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .set('Accept-Language', 'zh-CN')
      .send({ prompt: '   ' })
      .expect(400);

    const body = response.body as Record<string, unknown>;
    expect(body['code']).toBe('GENERATIVE_PROMPT_EMPTY');
    expect(String(body['title'])).toMatch(/[一-龥]/);
  });

  it('localizes an HTTP error for en', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .set('Accept-Language', 'en')
      .send({ prompt: '   ' })
      .expect(400);

    const body = response.body as Record<string, unknown>;
    expect(String(body['title'])).not.toMatch(/[一-龥]/);
  });
});
