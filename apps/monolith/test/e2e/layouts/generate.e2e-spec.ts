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
  SurfaceTurnContext,
} from '../../../src/modules/layouts/application/ports/surface-generator.js';

const GENERATE_PATH = (surface: string) =>
  `/api/v1/layouts/${surface}/generate`;
const TURN_PATH = (surface: string) => `/api/v1/layouts/${surface}/turn`;

/** A document the envelope check accepts. */
const VALID_MESSAGES = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'generative-review',
      catalogId: 'https://luminous.app/a2ui/catalog/v1.json',
      sendDataModel: true,
    },
  },
  {
    version: '1.0',
    updateComponents: {
      surfaceId: 'generative-review',
      components: [
        { id: 'root', component: 'Column', children: ['title'] },
        { id: 'title', component: 'Text', text: 'This week' },
      ],
    },
  },
];

const DOCUMENT = {
  messages: VALID_MESSAGES,
  dataModel: { 'generative-review': { dose: 2 } },
};

const ACTION = {
  version: '1.0',
  action: { name: 'confirm', surfaceId: 'generative-review' },
};

/**
 * Stands in for the LLM so the SSE plumbing, the envelope check, error mapping
 * and language forwarding are all exercised without a model or network.
 */
class FakeSurfaceGenerator implements SurfaceGenerator {
  configured = true;
  lastContext: SurfaceGenerationContext | undefined;
  lastTurnContext: SurfaceTurnContext | undefined;
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

  async continueWithStream(
    context: SurfaceTurnContext,
    onMessage: (message: Record<string, unknown>) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    this.lastTurnContext = context;
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
            : // Parsed JSON is `unknown` here; every assertion below narrows it
              // at the use site, which is what keeps this helper honest.
              (JSON.parse(dataLine.slice('data: '.length)) as unknown),
      };
    });
}

describe('Layouts generative endpoints (e2e)', () => {
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
    generator.lastTurnContext = undefined;
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

  it('returns 401 for an unauthenticated generate request', async () => {
    await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .send({ prompt: 'show my water trend' })
      .expect(401);
  });

  it('returns 401 for an unauthenticated turn request', async () => {
    await request(app.getHttpServer())
      .post(TURN_PATH('review'))
      .send({ messages: [ACTION], document: DOCUMENT })
      .expect(401);
  });

  // ── Generate: SSE happy path ─────────────────────────────────

  it('streams chunk events, then result, then done', async () => {
    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show my water trend' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');

    const frames = parseSse(response.text);
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

  it('forwards the client capabilities to the generator', async () => {
    const capabilities = {
      '1.0': {
        supportedCatalogIds: ['https://luminous.app/a2ui/catalog/v1.json'],
        inlineCatalogs: [
          {
            catalogId: 'https://luminous.app/a2ui/catalog/v1.json',
            components: { Text: {}, Button: {} },
          },
        ],
      },
    };

    await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show my water trend', capabilities })
      .expect(200);

    // A2UI 1.0: the prompt's vocabulary is built from this document, so it must
    // survive the hop.
    expect(generator.lastContext?.capabilities).toEqual(capabilities);
  });

  // ── Generate: envelope check ─────────────────────────────────

  it('rejects a v0.9 envelope', async () => {
    generator.output = {
      summary: 'bad',
      messages: [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'generative-review',
            components: [{ id: 'root', component: 'Column' }],
          },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show something' })
      .expect(200);

    const frames = parseSse(response.text);
    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('GENERATIVE_OUTPUT_REJECTED');
  });

  it('rejects a sequence with no root component', async () => {
    generator.output = {
      summary: 'bad',
      messages: [
        { version: '1.0', createSurface: { surfaceId: 'generative-review' } },
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'generative-review',
            components: [{ id: 'a', component: 'Text', text: 'orphan' }],
          },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'show something' })
      .expect(200);

    const frames = parseSse(response.text);
    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('GENERATIVE_OUTPUT_REJECTED');
  });

  it('accepts a Button — 1.0 dropped the writable-action ban', async () => {
    generator.output = {
      summary: 'interactive',
      messages: [
        { version: '1.0', createSurface: { surfaceId: 'generative-review' } },
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'generative-review',
            components: [
              { id: 'root', component: 'Button', child: 'label' },
              { id: 'label', component: 'Text', text: 'Delete all' },
            ],
          },
        },
      ],
    };

    const response = await request(app.getHttpServer())
      .post(GENERATE_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ prompt: 'add a delete button' })
      .expect(200);

    const frames = parseSse(response.text);
    expect(frames.map((f) => f.event)).toEqual([
      'chunk',
      'chunk',
      'result',
      'done',
    ]);
  });

  // ── Generate: request boundaries ─────────────────────────────

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
      .post(GENERATE_PATH('tab'))
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

    const frames = parseSse(response.text);
    const error = frames.find((f) => f.event === 'error')?.data as {
      code: string;
    };
    expect(error.code).toBe('LLM_NOT_CONFIGURED');
  });

  // ── Turn ─────────────────────────────────────────────────────

  it('streams the continuation with the same four frames', async () => {
    const response = await request(app.getHttpServer())
      .post(TURN_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ messages: [ACTION], document: DOCUMENT })
      .expect(200);

    const frames = parseSse(response.text);
    expect(frames.map((f) => f.event)).toEqual([
      'chunk',
      'chunk',
      'result',
      'done',
    ]);

    const result = frames.find((f) => f.event === 'result')?.data as {
      surface: string;
      messages: unknown[];
    };
    // The reply is the COMPLETE sequence, not a diff: the client overwrites the
    // surface with it.
    expect(result.messages).toHaveLength(VALID_MESSAGES.length);
  });

  it('hands the document to the generator (stateless server)', async () => {
    await request(app.getHttpServer())
      .post(TURN_PATH('medicine'))
      .set('Authorization', bearer(await token()))
      .send({ messages: [ACTION], document: DOCUMENT })
      .expect(200);

    // Without the document the agent would compose a fresh surface instead of
    // continuing the one the user is looking at.
    expect(generator.lastTurnContext?.document).toEqual(DOCUMENT);
    expect(generator.lastTurnContext?.messages).toEqual([ACTION]);
  });

  it('returns 422 GENERATIVE_TURN_EMPTY for an empty round', async () => {
    const response = await request(app.getHttpServer())
      .post(TURN_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ messages: [], document: DOCUMENT })
      .expect(422);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'GENERATIVE_TURN_EMPTY',
    );
  });

  it('returns 422 GENERATIVE_DOCUMENT_EMPTY when the document is missing', async () => {
    const response = await request(app.getHttpServer())
      .post(TURN_PATH('review'))
      .set('Authorization', bearer(await token()))
      .send({ messages: [ACTION], document: { messages: [] } })
      .expect(422);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'GENERATIVE_DOCUMENT_EMPTY',
    );
  });

  it('returns 400 GENERATIVE_SURFACE_UNSUPPORTED for the tab bar on turn', async () => {
    const response = await request(app.getHttpServer())
      .post(TURN_PATH('tab'))
      .set('Authorization', bearer(await token()))
      .send({ messages: [ACTION], document: DOCUMENT })
      .expect(400);

    expect((response.body as Record<string, unknown>)['code']).toBe(
      'GENERATIVE_SURFACE_UNSUPPORTED',
    );
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

  it('forwards Accept-Language on a turn too', async () => {
    await request(app.getHttpServer())
      .post(TURN_PATH('review'))
      .set('Authorization', bearer(await token()))
      .set('Accept-Language', 'zh-CN')
      .send({ messages: [ACTION], document: DOCUMENT })
      .expect(200);

    expect(generator.lastTurnContext?.language).toContain('zh');
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
