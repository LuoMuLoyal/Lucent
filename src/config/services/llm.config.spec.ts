import { EnvKey } from '../env/env-keys.enum';
import { llmConfig } from './llm.config';

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
      analysis: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
      };
      vision: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
      };
      language: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
      };
      chat: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
      };
      chatCompression: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
      };
      embedding: {
        apiKey: string | null;
        baseUrl: string | null;
        model: string | null;
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
    });
    expect(config.vision).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
    });
    expect(config.chat).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
    });
    expect(config.embedding).toEqual({
      apiKey: null,
      baseUrl: null,
      model: null,
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

  it('omits dimension when env var is absent', () => {
    process.env[EnvKey.AI_EMBEDDING_API_KEY] = 'sk-embed';

    const config = callFactory();

    expect(config.embedding.dimension).toBeUndefined();
  });

  it('omits dimension when env var is not a valid number', () => {
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
});
