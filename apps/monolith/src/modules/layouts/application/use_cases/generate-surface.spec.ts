import { DomainFailureException } from '../../../../common/result/index.js';
import type {
  SurfaceGenerator,
  SurfaceGenerationContext,
  SurfaceGenerationOutput,
} from '../ports/surface-generator.js';
import { GenerateSurface } from './generate-surface.js';

/**
 * Use-case tests.
 *
 * The generator is faked, so these pin down the ordering that matters: shape
 * validation before the model call, availability check before opening a stream,
 * and admission over the *complete* sequence rather than the streamed frames.
 */
class FakeGenerator implements SurfaceGenerator {
  constructor(
    private readonly output: SurfaceGenerationOutput | Error,
    private readonly configured = true,
  ) {}

  calls = 0;
  contexts: SurfaceGenerationContext[] = [];

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
}

const validMessages = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'generative.review',
      catalogId: 'com.luminous.generative',
      sendDataModel: false,
    },
  },
  {
    version: 'v0.9',
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

  it('fails the whole generation when admission rejects the tree', async () => {
    const useCase = new GenerateSurface(
      new FakeGenerator({
        summary: 'bad',
        messages: [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'generative.review',
              components: [{ id: 'root', component: 'Button' }],
            },
          },
        ],
      }),
    );

    await expect(useCase.execute(input, () => {})).rejects.toMatchObject({
      failure: { code: 'GENERATIVE_OUTPUT_REJECTED' },
    });
  });

  it('rejects a tree that streams clean but ends with a violation', async () => {
    // A partially streamed tree can look valid; admission runs on the full
    // sequence, so a late violation still fails the request.
    const useCase = new GenerateSurface(
      new FakeGenerator({
        summary: 'bad',
        messages: [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: 'generative.review',
              components: [
                { id: 'root', component: 'Column', children: ['a', 'b'] },
                { id: 'a', component: 'Text', text: 'fine' },
                {
                  id: 'b',
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

    await expect(useCase.execute(input, () => {})).rejects.toMatchObject({
      failure: { code: 'GENERATIVE_OUTPUT_REJECTED' },
    });
  });
});
