import { DomainFailureException } from '../../../../common/result/index.js';
import type {
  SurfaceGenerator,
  SurfaceGenerationContext,
  SurfaceGenerationOutput,
  SurfaceTurnContext,
} from '../ports/surface-generator.js';
import { GenerateSurface } from './generate-surface.js';

/**
 * Use-case tests.
 *
 * The generator is faked, so these pin down the ordering that matters: shape
 * validation before the model call, availability check before opening a stream,
 * and the envelope check over the *complete* sequence rather than the streamed
 * frames.
 *
 * A2UI 1.0 moved the component vocabulary to the client, so the cases that used
 * to prove "no Button / no numbers" are gone with `surface-policy.ts`. What is
 * left is structure: v1.0 envelopes, one body key each, a createSurface and a
 * root.
 */
class FakeGenerator implements SurfaceGenerator {
  constructor(
    private readonly output: SurfaceGenerationOutput | Error,
    private readonly configured = true,
  ) {}

  calls = 0;
  turnCalls = 0;
  contexts: SurfaceGenerationContext[] = [];
  turnContexts: SurfaceTurnContext[] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async generateWithStream(
    context: SurfaceGenerationContext,
    onMessage: (message: Record<string, unknown>) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    this.calls += 1;
    this.contexts.push(context);

    if (this.output instanceof Error) throw this.output;

    for (const message of this.output.messages) {
      await onMessage(message);
    }
    return this.output;
  }

  async continueWithStream(
    context: SurfaceTurnContext,
    onMessage: (message: Record<string, unknown>) => void | Promise<void>,
  ): Promise<SurfaceGenerationOutput> {
    this.turnCalls += 1;
    this.turnContexts.push(context);

    if (this.output instanceof Error) throw this.output;

    for (const message of this.output.messages) {
      await onMessage(message);
    }
    return this.output;
  }
}

const validMessages = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'generative.review',
      catalogId: 'https://luminous.app/a2ui/catalog/v1.json',
      sendDataModel: true,
    },
  },
  {
    version: '1.0',
    updateComponents: {
      surfaceId: 'generative.review',
      components: [
        { id: 'root', component: 'Column', children: ['title'] },
        { id: 'title', component: 'Text', text: 'This week' },
      ],
    },
  },
];

const validOutput: SurfaceGenerationOutput = {
  summary: 'A compact weekly overview',
  messages: validMessages,
};

describe('GenerateSurface', () => {
  const input = {
    surface: 'review',
    prompt: 'make a weekly overview',
    language: 'en',
  };

  it('returns the produced messages with usage', async () => {
    const useCase = new GenerateSurface(new FakeGenerator(validOutput));
    const result = await useCase.execute(input, () => {});

    expect(result.surface).toBe('review');
    expect(result.messages).toHaveLength(2);
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('streams each message to the callback', async () => {
    const seen: unknown[] = [];
    const useCase = new GenerateSurface(new FakeGenerator(validOutput));

    await useCase.execute(input, (message) => {
      seen.push(message);
    });

    expect(seen).toHaveLength(2);
  });

  it('passes the language through to the generator', async () => {
    // The language decides the copy of the *generated* strings, so dropping it
    // here would silently produce English surfaces for zh-CN clients.
    const generator = new FakeGenerator(validOutput);
    await new GenerateSurface(generator).execute(
      { ...input, language: 'zh-CN' },
      () => {},
    );

    expect(generator.contexts[0]?.language).toBe('zh-CN');
  });

  it('passes the client capabilities through to the generator', async () => {
    // In v1.0 the prompt's component vocabulary is built from this document, so
    // losing it here means the model is taught a vocabulary the client does not
    // render.
    const capabilities = {
      '1.0': {
        supportedCatalogIds: ['https://luminous.app/a2ui/catalog/v1.json'],
      },
    };
    const generator = new FakeGenerator(validOutput);
    await new GenerateSurface(generator).execute(
      { ...input, capabilities },
      () => {},
    );

    expect(generator.contexts[0]?.capabilities).toEqual(capabilities);
  });

  it('does not call the model when the request is invalid', async () => {
    const generator = new FakeGenerator(validOutput);
    const useCase = new GenerateSurface(generator);

    await expect(
      useCase.execute({ ...input, prompt: '   ' }, () => {}),
    ).rejects.toBeInstanceOf(DomainFailureException);

    expect(generator.calls).toBe(0);
  });

  it('does not call the model when no model is configured', async () => {
    const generator = new FakeGenerator(validOutput, false);
    const useCase = new GenerateSurface(generator);

    await expect(useCase.execute(input, () => {})).rejects.toMatchObject({
      failure: { code: 'LLM_NOT_CONFIGURED' },
    });

    expect(generator.calls).toBe(0);
  });

  it('fails the whole generation when the envelope is wrong', async () => {
    const useCase = new GenerateSurface(
      new FakeGenerator({
        summary: 'bad',
        messages: [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'generative.review',
              components: [{ id: 'root', component: 'Column' }],
            },
          },
        ],
      }),
    );

    await expect(useCase.execute(input, () => {})).rejects.toMatchObject({
      failure: { code: 'GENERATIVE_OUTPUT_REJECTED' },
    });
  });

  it('rejects a sequence that streams clean but has no root', async () => {
    // A partially streamed tree can look valid; the check runs on the full
    // sequence, so a missing root still fails the request.
    const useCase = new GenerateSurface(
      new FakeGenerator({
        summary: 'bad',
        messages: [
          {
            version: '1.0',
            createSurface: { surfaceId: 'generative.review' },
          },
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 'generative.review',
              components: [{ id: 'a', component: 'Text', text: 'fine' }],
            },
          },
        ],
      }),
    );

    await expect(useCase.execute(input, () => {})).rejects.toMatchObject({
      failure: { code: 'GENERATIVE_OUTPUT_REJECTED' },
    });
  });

  it('accepts a Button — 1.0 dropped the writable-action ban', async () => {
    const useCase = new GenerateSurface(
      new FakeGenerator({
        summary: 'interactive',
        messages: [
          {
            version: '1.0',
            createSurface: { surfaceId: 'generative.review' },
          },
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 'generative.review',
              components: [
                { id: 'root', component: 'Button', child: 'label' },
                { id: 'label', component: 'Text', text: 'Save' },
              ],
            },
          },
        ],
      }),
    );

    const result = await useCase.execute(input, () => {});
    expect(result.messages).toHaveLength(2);
  });

  it('accepts a metric_card carrying an explicit value', async () => {
    // The "no numbers" rule belonged to the v0.9 admission policy. A2UI 1.0 has
    // no such rule; the client's schema decides what a component may carry.
    const useCase = new GenerateSurface(
      new FakeGenerator({
        summary: 'numbers allowed',
        messages: [
          {
            version: '1.0',
            createSurface: { surfaceId: 'generative.review' },
          },
          {
            version: '1.0',
            updateComponents: {
              surfaceId: 'generative.review',
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
      }),
    );

    const result = await useCase.execute(input, () => {});
    expect(result.messages).toHaveLength(2);
  });

  it('rejects an oversized capabilities document', async () => {
    const generator = new FakeGenerator(validOutput);
    await expect(
      new GenerateSurface(generator).execute(
        {
          ...input,
          capabilities: { blob: 'x'.repeat(300 * 1024) },
        },
        () => {},
      ),
    ).rejects.toMatchObject({
      failure: { code: 'GENERATIVE_CAPABILITIES_TOO_LARGE' },
    });

    expect(generator.calls).toBe(0);
  });
});
