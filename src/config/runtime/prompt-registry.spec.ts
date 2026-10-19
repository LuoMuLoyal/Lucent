import { EnvKey } from '../env/env-keys.enum.js';
import {
  RUNTIME_CONFIG_FIELDS,
  type RuntimeConfigValues,
} from './runtime-config.schema.js';
import type { RuntimeConfigSnapshot } from './runtime-config.types.js';
import {
  fingerprintPrompt,
  resolveRuntimePrompt,
  RUNTIME_PROMPT_KEYS,
  RUNTIME_PROMPT_SPECS,
  type RuntimePromptName,
  type RuntimePromptSpec,
  type RuntimePromptSource,
} from './prompt-registry.js';

function sourceWith(values: Partial<RuntimeConfigValues>): RuntimePromptSource {
  let revision = 1;
  return {
    getSnapshot: (): RuntimeConfigSnapshot => ({
      values: values as RuntimeConfigValues,
      version: `test#${String(revision++)}`,
      source: 'remote',
      revision: 'test',
      seq: 1,
    }),
  };
}

const baseline = () => 'code prompt';

describe('resolveRuntimePrompt', () => {
  it('returns the code prompt when there is no snapshot service', () => {
    expect(resolveRuntimePrompt(undefined, 'todayAnalysis', baseline, {})).toBe(
      'code prompt',
    );
  });

  it('returns the code prompt when the document declares no override', () => {
    const source = sourceWith({ [EnvKey.PROMPT_TODAY_ANALYSIS]: null });

    expect(resolveRuntimePrompt(source, 'todayAnalysis', baseline, {})).toBe(
      'code prompt',
    );
  });

  it('returns the published text for a prompt without placeholders', () => {
    const source = sourceWith({
      [EnvKey.PROMPT_TODAY_ANALYSIS]: 'published prompt',
    });

    expect(resolveRuntimePrompt(source, 'todayAnalysis', baseline, {})).toBe(
      'published prompt',
    );
  });

  it('fills every occurrence of a declared placeholder', () => {
    const source = sourceWith({
      [EnvKey.PROMPT_MEAL_ANALYSIS_SYSTEM]: 'Write in {{language}}.',
      [EnvKey.PROMPT_MEAL_ANALYSIS_USER]:
        'Speak {{language}} like {{language}}.',
    });

    expect(
      resolveRuntimePrompt(source, 'mealAnalysisSystem', baseline, {
        language: '中文',
      }),
    ).toBe('Write in 中文.');
    expect(
      resolveRuntimePrompt(source, 'mealAnalysisUser', baseline, {
        language: 'English',
      }),
    ).toBe('Speak English like English.');
  });

  it('does not touch markers the prompt does not declare', () => {
    const source = sourceWith({
      [EnvKey.PROMPT_SUGGESTION_COPY]: 'Tone: {{tone}}. Unknown: {{other}}.',
    });

    expect(
      resolveRuntimePrompt(source, 'suggestionCopy', baseline, {
        tone: 'gentle',
      }),
    ).toBe('Tone: gentle. Unknown: {{other}}.');
  });

  it('falls back to the code prompt when the caller cannot supply a value', () => {
    // A literal placeholder must never reach the model; the code prompt is the
    // only known-good text in that situation.
    const source = sourceWith({
      [EnvKey.PROMPT_SUGGESTION_COPY]: 'Tone: {{tone}}.',
    });

    expect(
      resolveRuntimePrompt(
        source,
        'suggestionCopy',
        baseline,
        {} as { tone: string },
      ),
    ).toBe('code prompt');
  });

  it('reads the snapshot on every call so a push applies immediately', () => {
    let values: Partial<RuntimeConfigValues> = {
      [EnvKey.PROMPT_TODAY_ANALYSIS]: 'first',
    };
    const source: RuntimePromptSource = {
      getSnapshot: () => ({
        values: values as RuntimeConfigValues,
        version: 'test#1',
        source: 'remote',
        revision: 'test',
        seq: 1,
      }),
    };

    expect(resolveRuntimePrompt(source, 'todayAnalysis', baseline, {})).toBe(
      'first',
    );

    values = { [EnvKey.PROMPT_TODAY_ANALYSIS]: 'second' };
    expect(resolveRuntimePrompt(source, 'todayAnalysis', baseline, {})).toBe(
      'second',
    );
  });
});

describe('RUNTIME_PROMPT_SPECS', () => {
  const specs = Object.entries(RUNTIME_PROMPT_SPECS) as [
    RuntimePromptName,
    RuntimePromptSpec,
  ][];

  it('declares exactly the placeholders the document parser requires', () => {
    for (const [name, spec] of specs) {
      const field = RUNTIME_CONFIG_FIELDS[spec.key];
      const complete = spec.placeholders
        .map((placeholder) => `{{${placeholder}}}`)
        .join(' ');
      expect({ name, ok: field.parse(`text ${complete}`).ok }).toEqual({
        name,
        ok: true,
      });

      for (const dropped of spec.placeholders) {
        const partial = spec.placeholders
          .filter((placeholder) => placeholder !== dropped)
          .map((placeholder) => `{{${placeholder}}}`)
          .join(' ');
        expect({ name, dropped, ok: field.parse(partial).ok }).toEqual({
          name,
          dropped,
          ok: false,
        });
      }
    }
  });

  it('covers every prompt key the document may carry', () => {
    const declared = new Set<string>(specs.map(([, spec]) => spec.key));
    const promptKeys = RUNTIME_PROMPT_KEYS;

    expect(promptKeys.every((key) => declared.has(key))).toBe(true);
    expect(declared.size).toBe(promptKeys.length);
  });
});

describe('fingerprintPrompt', () => {
  it('is stable and short enough for a log line', () => {
    const digest = fingerprintPrompt('same text');

    expect(digest).toMatch(/^[0-9a-f]{12}$/u);
    expect(fingerprintPrompt('same text')).toBe(digest);
    expect(fingerprintPrompt('other text')).not.toBe(digest);
    expect(digest).not.toContain('same text');
  });
});
