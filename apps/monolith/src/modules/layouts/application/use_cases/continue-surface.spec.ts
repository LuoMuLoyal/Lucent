import { DomainFailureException } from '../../../../common/result/index.js';
import type {
  SurfaceGenerator,
  SurfaceGenerationOutput,
  SurfaceTurnContext,
} from '../ports/surface-generator.js';
import { ContinueSurface } from './continue-surface.js';
import { GenerateSurface } from './generate-surface.js';

/**
 * Continuation rounds.
 *
 * The server is stateless: a round carries the renderer's outbound messages and
 * the document they act on. These cases pin down that the document survives the
 * hop (the agent cannot continue a surface it cannot see) and that a turn's
 * product passes the same envelope check a first pass does.
 */
class FakeGenerator implements SurfaceGenerator {
  constructor(
    private readonly output: SurfaceGenerationOutput | Error,
    private readonly configured = true,
  ) {}

  calls = 0;
  contexts: SurfaceTurnContext[] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  generateWithStream(): Promise<SurfaceGenerationOutput> {
    return Promise.reject(
      new Error('generateWithStream is not used by this suite'),
    );
  }

  async continueWithStream(
    context: SurfaceTurnContext,
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

const document = {
  messages: [
    { version: '1.0', createSurface: { surfaceId: 'generative.medicine' } },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'generative.medicine',
        components: [{ id: 'root', component: 'Text', text: 'before' }],
      },
    },
  ],
  dataModel: { 'generative.medicine': { dose: 2 } },
};

const action = {
  version: '1.0',
  action: { name: 'confirm_dose', surfaceId: 'generative.medicine' },
};

const validOutput: SurfaceGenerationOutput = {
  summary: 'continued',
  messages: [
    { version: '1.0', createSurface: { surfaceId: 'generative.medicine' } },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'generative.medicine',
        components: [{ id: 'root', component: 'Text', text: 'after' }],
      },
    },
  ],
};

function build(generator: SurfaceGenerator): ContinueSurface {
  // The envelope check lives on GenerateSurface so both endpoints share one
  // definition of "well-formed v1.0 surface".
  return new ContinueSurface(generator, new GenerateSurface(generator));
}

describe('ContinueSurface', () => {
  const input = {
    surface: 'medicine',
    messages: [action],
    document,
    language: 'en',
  };

  it('returns the continuation sequence', async () => {
    const result = await build(new FakeGenerator(validOutput)).execute(
      input,
      () => {},
    );

    expect(result.surface).toBe('medicine');
    expect(result.messages).toHaveLength(2);
  });

  it('hands the document to the generator', async () => {
    // Stateless server: without this the agent cannot continue the same surface
    // and would compose a fresh one instead.
    const generator = new FakeGenerator(validOutput);
    await build(generator).execute(input, () => {});

    expect(generator.contexts[0]?.document).toEqual(document);
    expect(generator.contexts[0]?.messages).toEqual([action]);
  });

  it('rejects an empty turn without calling the model', async () => {
    const generator = new FakeGenerator(validOutput);

    await expect(
      build(generator).execute({ ...input, messages: [] }, () => {}),
    ).rejects.toMatchObject({ failure: { code: 'GENERATIVE_TURN_EMPTY' } });

    expect(generator.calls).toBe(0);
  });

  it('rejects a turn with no document without calling the model', async () => {
    const generator = new FakeGenerator(validOutput);

    await expect(
      build(generator).execute(
        { ...input, document: { messages: [] } },
        () => {},
      ),
    ).rejects.toMatchObject({ failure: { code: 'GENERATIVE_DOCUMENT_EMPTY' } });

    expect(generator.calls).toBe(0);
  });

  it('rejects too many messages in one turn', async () => {
    const generator = new FakeGenerator(validOutput);

    await expect(
      build(generator).execute(
        { ...input, messages: Array.from({ length: 21 }, () => action) },
        () => {},
      ),
    ).rejects.toMatchObject({ failure: { code: 'GENERATIVE_TURN_TOO_LARGE' } });

    expect(generator.calls).toBe(0);
  });

  it('rejects the tab bar as a surface', async () => {
    await expect(
      build(new FakeGenerator(validOutput)).execute(
        { ...input, surface: 'tab' },
        () => {},
      ),
    ).rejects.toBeInstanceOf(DomainFailureException);
  });

  it('fails when the continuation is not a valid v1.0 surface', async () => {
    await expect(
      build(
        new FakeGenerator({
          summary: 'bad',
          messages: [
            {
              version: 'v0.9',
              updateComponents: { surfaceId: 's', components: [] },
            },
          ],
        }),
      ).execute(input, () => {}),
    ).rejects.toMatchObject({
      failure: { code: 'GENERATIVE_OUTPUT_REJECTED' },
    });
  });
});
