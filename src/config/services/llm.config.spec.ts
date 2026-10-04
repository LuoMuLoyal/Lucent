import { EnvKey } from '../env/env-keys.enum.js';
import { llmConfig } from './llm.config.js';

describe('llmConfig', () => {
  const saved: Record<string, string | undefined> = {};
  const keysToClean = [
    EnvKey.AI_PROVIDER,
    EnvKey.AI_ANALYSIS_API_KEY,
    EnvKey.AI_ANALYSIS_BASE_URL,
    EnvKey.AI_ANALYSIS_MODEL,
    EnvKey.AI_VISION_API_KEY,
    EnvKey.AI_VISION_BASE_URL,
    EnvKey.AI_VISION_MODEL,
    EnvKey.AI_LANGUAGE_API_KEY,
    EnvKey.AI_LANGUAGE_BASE_URL,
    EnvKey.AI_LANGUAGE_MODEL,
    EnvKey.AI_CHAT_API_KEY,
    EnvKey.AI_CHAT_BASE_URL,
    EnvKey.AI_CHAT_MODEL,
    EnvKey.AI_CHAT_COMPRESSION_API_KEY,
    EnvKey.AI_CHAT_COMPRESSION_BASE_URL,
    EnvKey.AI_CHAT_COMPRESSION_MODEL,
    EnvKey.AI_EMBEDDING_API_KEY,
    EnvKey.AI_EMBEDDING_BASE_URL,
    EnvKey.AI_EMBEDDING_MODEL,
    EnvKey.AI_EMBEDDING_DIMENSION,
    EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS,
    EnvKey.AI_THINKING,
    EnvKey.AI_ANALYSIS_THINKING,
    EnvKey.AI_VISION_THINKING,
    EnvKey.AI_LANGUAGE_THINKING,
    EnvKey.AI_CHAT_THINKING,
    EnvKey.AI_CHAT_COMPRESSION_THINKING,
  ];

  beforeEach(() => {
    for (const key of keysToClean) {
      saved[key] = process.env[key];
      Reflect.deleteProperty(process.env, key);
    }
  });

  afterEach(() => {
    for (const key of keysToClean) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        Reflect.deleteProperty(process.env, key);
      }
    }
  });

  function callFactory() {
    return llmConfig() as {
      provider: string | null;
      thinking: string;
      analysis: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
        thinking: string;
      };
      vision: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
        thinking: string;
      };
      language: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
        thinking: string;
      };
      chat: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
        thinking: string;
      };
      chatCompression: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
        thinking: string;
      };
      embedding: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
        thinking: string;
        dimension?: number;
      };
      safety: { forbiddenPatterns: string[] };
    };
  }

  it('returns all-null role configs and empty patterns when no env vars are set', () => {
    const config = callFactory();

    expect(config.provider).toBeNull();
    expect(config.analysis).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
      thinking: 'auto',
    });
    expect(config.vision).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
      thinking: 'auto',
    });
    expect(config.chat).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
      thinking: 'auto',
    });
    expect(config.embedding).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
      thinking: 'auto',
      // dimension default (1536) now lives in the zod layer; the factory
      // passes the raw env value through, so it is absent when unset.
      dimension: undefined,
    });
    expect(config.safety.forbiddenPatterns).toEqual([]);
  });

  it('reads provider and analysis role config from env', () => {
    process.env[EnvKey.AI_PROVIDER] = 'openai';
    process.env[EnvKey.AI_ANALYSIS_API_KEY] = 'sk-analysis';
    process.env[EnvKey.AI_ANALYSIS_BASE_URL] = 'https://api.openai.com/v1';
    process.env[EnvKey.AI_ANALYSIS_MODEL] = 'gpt-4o';

    const config = callFactory();

    expect(config.provider).toBe('openai');
    expect(config.analysis).toEqual({
      apiKey: 'sk-analysis',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      thinking: 'auto',
    });
  });

  it('trims whitespace from env values', () => {
    process.env[EnvKey.AI_CHAT_API_KEY] = '  sk-chat  ';
    process.env[EnvKey.AI_CHAT_BASE_URL] = '  https://api.example.com  ';
    process.env[EnvKey.AI_CHAT_MODEL] = '  gpt-4o-mini  ';

    const config = callFactory();

    expect(config.chat.apiKey).toBe('sk-chat');
    expect(config.chat.baseUrl).toBe('https://api.example.com');
    expect(config.chat.model).toBe('gpt-4o-mini');
  });

  it('returns null for whitespace-only env values', () => {
    process.env[EnvKey.AI_CHAT_API_KEY] = '   ';

    const config = callFactory();

    expect(config.chat.apiKey).toBeNull();
  });

  it('parses embedding dimension as a number', () => {
    process.env[EnvKey.AI_EMBEDDING_API_KEY] = 'sk-embed';
    process.env[EnvKey.AI_EMBEDDING_MODEL] = 'text-embedding-3-small';
    process.env[EnvKey.AI_EMBEDDING_DIMENSION] = '768';

    const config = callFactory();

    expect(config.embedding.dimension).toBe(768);
  });

  it('leaves dimension undefined when env var is absent (default lives in zod layer)', () => {
    process.env[EnvKey.AI_EMBEDDING_API_KEY] = 'sk-embed';

    const config = callFactory();

    expect(config.embedding.dimension).toBeUndefined();
  });

  it('falls back to undefined when env var is not a valid number', () => {
    process.env[EnvKey.AI_EMBEDDING_DIMENSION] = 'not-a-number';

    const config = callFactory();

    expect(config.embedding.dimension).toBeUndefined();
  });

  it('parses forbidden patterns split by comma', () => {
    process.env[EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS] =
      'pattern1, pattern2, pattern3';

    const config = callFactory();

    expect(config.safety.forbiddenPatterns).toEqual([
      'pattern1',
      'pattern2',
      'pattern3',
    ]);
  });

  it('parses forbidden patterns split by newline', () => {
    process.env[EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS] =
      'pattern1\npattern2\npattern3';

    const config = callFactory();

    expect(config.safety.forbiddenPatterns).toEqual([
      'pattern1',
      'pattern2',
      'pattern3',
    ]);
  });

  it('parses forbidden patterns with mixed comma and newline separators', () => {
    process.env[EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS] =
      'pattern1, pattern2\npattern3\npattern4, pattern5';

    const config = callFactory();

    expect(config.safety.forbiddenPatterns).toEqual([
      'pattern1',
      'pattern2',
      'pattern3',
      'pattern4',
      'pattern5',
    ]);
  });

  it('filters out empty patterns', () => {
    process.env[EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS] =
      'pattern1, , \n, pattern2\n\n  ';

    const config = callFactory();

    expect(config.safety.forbiddenPatterns).toEqual(['pattern1', 'pattern2']);
  });

  it('returns empty patterns array for whitespace-only value', () => {
    process.env[EnvKey.AI_SAFETY_FORBIDDEN_PATTERNS] = '   ';

    const config = callFactory();

    expect(config.safety.forbiddenPatterns).toEqual([]);
  });

  // ── Thinking mode ───────────────────────────────────────────────────

  it('defaults every role to thinking=auto when nothing is configured', () => {
    const config = callFactory();

    expect(config.thinking).toBe('auto');
    expect(config.analysis.thinking).toBe('auto');
    expect(config.chat.thinking).toBe('auto');
    expect(config.chatCompression.thinking).toBe('auto');
  });

  it('applies the global thinking mode to roles without an override', () => {
    process.env[EnvKey.AI_THINKING] = 'disabled';

    const config = callFactory();

    expect(config.thinking).toBe('disabled');
    expect(config.analysis.thinking).toBe('disabled');
    expect(config.chat.thinking).toBe('disabled');
    // Embedding has no chat model, but it must still resolve to the global
    // value rather than something undefined.
    expect(config.embedding.thinking).toBe('disabled');
  });

  it('lets a role-level thinking mode override the global one', () => {
    process.env[EnvKey.AI_THINKING] = 'disabled';
    process.env[EnvKey.AI_CHAT_THINKING] = 'enabled';

    const config = callFactory();

    expect(config.chat.thinking).toBe('enabled');
    expect(config.analysis.thinking).toBe('disabled');
  });

  it('treats an unrecognized thinking value as auto, not as disabled', () => {
    // A typo must not silently change provider behaviour.
    process.env[EnvKey.AI_THINKING] = 'disable';
    process.env[EnvKey.AI_ANALYSIS_THINKING] = 'false';

    const config = callFactory();

    expect(config.thinking).toBe('auto');
    expect(config.analysis.thinking).toBe('auto');
  });

  it('accepts thinking values case-insensitively', () => {
    process.env[EnvKey.AI_ANALYSIS_THINKING] = 'DISABLED';

    const config = callFactory();

    expect(config.analysis.thinking).toBe('disabled');
  });
});
