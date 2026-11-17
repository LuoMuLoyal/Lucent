import { ServiceUnavailableException } from '@nestjs/common';
import type { LlmConfig } from '../config/services/llm.config.js';
import { AI_MODEL_TIMEOUT_MS } from '../config/app-defaults.constants.js';
import { EnvKey } from '../config/env/env-keys.enum.js';
import type { RuntimeConfigValues } from '../config/runtime/runtime-config.schema.js';
import type { RuntimeConfigPort } from '../config/runtime/runtime-config.types.js';
import { LlmRuntimeService } from './llm-runtime.service.js';

/** Snapshot stand-in: only the values each test declares are present. */
function runtimeWith(values: Partial<RuntimeConfigValues>): RuntimeConfigPort {
  const snapshot = {
    values: values as RuntimeConfigValues,
    version: 'test#1',
    source: 'remote' as const,
    revision: 'test',
    seq: 1,
  };
  return {
    getSnapshot: () => snapshot,
    getVersion: () => snapshot.version,
    applyDocument: () => ({ ok: true, version: snapshot.version, changed: [] }),
    subscribe: () => () => undefined,
  };
}

function chatFields(model: object): Record<string, unknown> {
  return (model as { fields?: Record<string, unknown> }).fields ?? {};
}

describe('LlmRuntimeService', () => {
  const baseConfig: LlmConfig = {
    provider: 'openai-compatible',
    analysis: {
      apiKey: 'analysis-key',
      baseUrl: 'https://analysis.example.com/v1',
      model: 'analysis-model',
    },
    vision: { apiKey: null, baseUrl: null, model: null, thinking: 'auto' },
    language: { apiKey: null, baseUrl: null, model: null, thinking: 'auto' },
    chat: { apiKey: null, baseUrl: null, model: null, thinking: 'auto' },
    chatCompression: {
      apiKey: null,
      baseUrl: null,
      model: null,
      thinking: 'auto',
    },
    embedding: { apiKey: null, baseUrl: null, model: null, thinking: 'auto' },
    safety: { forbiddenPatterns: [] },
  };

  // ── hasRoleConfig ──────────────────────────────────────────────────────

  describe('hasRoleConfig', () => {
    it('returns true for a fully configured role', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.hasRoleConfig('analysis')).toBe(true);
    });

    it('returns false when the role has no apiKey', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          apiKey: null,
          baseUrl: 'url',
          model: 'model',
          thinking: 'auto',
        },
      });

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('returns false when the role has no baseUrl', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          apiKey: 'key',
          baseUrl: null,
          model: 'model',
          thinking: 'auto',
        },
      });

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('returns false when the role has no model', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          apiKey: 'key',
          baseUrl: 'url',
          model: null,
          thinking: 'auto',
        },
      });

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('returns false for every unconfigured role in the base config', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.hasRoleConfig('vision')).toBe(false);
      expect(service.hasRoleConfig('language')).toBe(false);
      expect(service.hasRoleConfig('chat')).toBe(false);
      expect(service.hasRoleConfig('chatCompression')).toBe(false);
      expect(service.hasRoleConfig('embedding')).toBe(false);
    });

    it('returns false for every role when provider is not openai-compatible', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        provider: null,
      });

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('returns true for all roles when every role is configured', () => {
      const fullConfig: LlmConfig = {
        ...baseConfig,
        vision: {
          apiKey: 'v-key',
          baseUrl: 'https://v.test',
          model: 'v-model',
        },
        language: {
          apiKey: 'l-key',
          baseUrl: 'https://l.test',
          model: 'l-model',
        },
        chat: {
          apiKey: 'c-key',
          baseUrl: 'https://c.test',
          model: 'c-model',
          thinking: 'auto',
        },
        chatCompression: {
          apiKey: 'cc-key',
          baseUrl: 'https://cc.test',
          model: 'cc-model',
        },
        embedding: {
          apiKey: 'e-key',
          baseUrl: 'https://e.test',
          model: 'e-model',
        },
      };
      const service = new LlmRuntimeService(fullConfig);

      expect(service.hasRoleConfig('analysis')).toBe(true);
      expect(service.hasRoleConfig('vision')).toBe(true);
      expect(service.hasRoleConfig('language')).toBe(true);
      expect(service.hasRoleConfig('chat')).toBe(true);
      expect(service.hasRoleConfig('chatCompression')).toBe(true);
      expect(service.hasRoleConfig('embedding')).toBe(true);
    });
  });

  // ── getConfiguredRoles / isHealthy ─────────────────────────────────────

  describe('getConfiguredRoles', () => {
    it('returns only the configured roles', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.getConfiguredRoles()).toEqual(['analysis']);
    });

    it('returns empty array when no roles are configured', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        provider: null,
      });

      expect(service.getConfiguredRoles()).toEqual([]);
    });
  });

  describe('isHealthy', () => {
    it('returns true when at least one role is configured', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.isHealthy()).toBe(true);
    });

    it('returns false when no roles are configured', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        provider: null,
      });

      expect(service.isHealthy()).toBe(false);
    });
  });

  // ── getModelName ──────────────────────────────────────────────────────

  describe('getModelName', () => {
    it('returns the model name for a configured role', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.getModelName('analysis')).toBe('analysis-model');
    });

    it('returns null when the role model is not set', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.getModelName('chat')).toBeNull();
    });

    it('returns the model name for every configured role in a full config', () => {
      const fullConfig: LlmConfig = {
        ...baseConfig,
        vision: {
          apiKey: 'v-key',
          baseUrl: 'https://v.test',
          model: 'v-model',
        },
        language: {
          apiKey: 'l-key',
          baseUrl: 'https://l.test',
          model: 'l-model',
        },
        chat: {
          apiKey: 'c-key',
          baseUrl: 'https://c.test',
          model: 'c-model',
          thinking: 'auto',
        },
        chatCompression: {
          apiKey: 'cc-key',
          baseUrl: 'https://cc.test',
          model: 'cc-model',
        },
        embedding: {
          apiKey: 'e-key',
          baseUrl: 'https://e.test',
          model: 'e-model',
        },
      };
      const service = new LlmRuntimeService(fullConfig);

      expect(service.getModelName('analysis')).toBe('analysis-model');
      expect(service.getModelName('vision')).toBe('v-model');
      expect(service.getModelName('language')).toBe('l-model');
      expect(service.getModelName('chat')).toBe('c-model');
      expect(service.getModelName('chatCompression')).toBe('cc-model');
      expect(service.getModelName('embedding')).toBe('e-model');
    });
  });

  // ── createChatModel ────────────────────────────────────────────────────

  describe('createChatModel', () => {
    it('creates a chat model with full options', () => {
      const service = new LlmRuntimeService(baseConfig);

      const model = service.createChatModel('analysis', {
        timeout: AI_MODEL_TIMEOUT_MS,
        temperature: 0.2,
        maxRetries: 0,
      });

      expect(model).toBeDefined();
    });

    it('creates a chat model without options', () => {
      const service = new LlmRuntimeService(baseConfig);

      const model = service.createChatModel('analysis');

      expect(model).toBeDefined();
    });

    it('creates a chat model with partial options', () => {
      const service = new LlmRuntimeService(baseConfig);

      const model = service.createChatModel('analysis', { temperature: 0.5 });

      expect(model).toBeDefined();
    });

    it('disables DeepSeek thinking mode when the baseUrl points to deepseek', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          ...baseConfig.analysis,
          baseUrl: 'https://api.deepseek.com',
        },
      });

      const model = service.createChatModel('analysis');

      expect(model.modelKwargs).toEqual({ thinking: { type: 'disabled' } });
    });

    it('does not set thinking-disabled for non-deepseek baseUrls', () => {
      const service = new LlmRuntimeService(baseConfig);

      const model = service.createChatModel('analysis');

      // LangChain defaults the field to an empty object; what matters is that
      // no reasoning directive was emitted.
      expect(model.modelKwargs ?? {}).toEqual({});
    });

    it('honours an explicit enabled mode on DeepSeek', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          ...baseConfig.analysis,
          baseUrl: 'https://api.deepseek.com',
          thinking: 'enabled',
        },
      });

      const model = service.createChatModel('analysis');

      expect(model.modelKwargs).toEqual({ thinking: { type: 'enabled' } });
    });

    it('keeps the legacy Aliyun qwen3 default under auto', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          ...baseConfig.analysis,
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3-max',
        },
      });

      const model = service.createChatModel('analysis');

      expect(model.modelKwargs).toEqual({ enable_thinking: false });
    });

    it('leaves auto untouched for a non-qwen model on an Aliyun host', () => {
      // The regression this fixes: production runs deepseek-v4.1-flash through
      // an Aliyun MaaS gateway, which matched neither legacy branch — so
      // thinking was silently uncontrolled. `auto` must stay a no-op here.
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          ...baseConfig.analysis,
          baseUrl:
            'https://ws-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
          model: 'deepseek-v4.1-flash',
        },
      });

      const model = service.createChatModel('analysis');

      // LangChain defaults the field to an empty object; what matters is that
      // no reasoning directive was emitted.
      expect(model.modelKwargs ?? {}).toEqual({});
    });

    it('controls thinking on an Aliyun host that auto would have skipped', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          ...baseConfig.analysis,
          baseUrl:
            'https://ws-abc.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
          model: 'deepseek-v4.1-flash',
          thinking: 'disabled',
        },
      });

      const model = service.createChatModel('analysis');

      expect(model.modelKwargs).toEqual({ enable_thinking: false });
    });

    it('sends nothing for an unrecognized gateway even when set explicitly', () => {
      // Guessing a payload shape here would turn a config mistake into a
      // provider-side request validation error.
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: {
          ...baseConfig.analysis,
          baseUrl: 'https://models.example.com/v1',
          thinking: 'disabled',
        },
      });

      const model = service.createChatModel('analysis');

      // LangChain defaults the field to an empty object; what matters is that
      // no reasoning directive was emitted.
      expect(model.modelKwargs ?? {}).toEqual({});
    });

    it('creates a chat model for an unconfigured role using fallback values', () => {
      const service = new LlmRuntimeService(baseConfig);

      // Even though 'chat' role is not configured, createChatModel still
      // returns a model instance (with empty-string fallbacks).
      const model = service.createChatModel('chat');

      expect(model).toBeDefined();
    });
  });

  // ── requireChatModel ───────────────────────────────────────────────────

  describe('requireChatModel', () => {
    it('creates a chat model when the role is configured', () => {
      const service = new LlmRuntimeService(baseConfig);

      const model = service.requireChatModel('analysis');

      expect(model).toBeDefined();
    });

    it('throws ServiceUnavailableException when the role is not configured', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(() => service.requireChatModel('chat')).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ── createEmbeddingModel ───────────────────────────────────────────────

  describe('createEmbeddingModel', () => {
    it('returns null when embedding role is not configured', () => {
      const service = new LlmRuntimeService(baseConfig);

      expect(service.createEmbeddingModel()).toBeNull();
    });

    it('returns null when provider is not openai-compatible', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        provider: null,
        embedding: {
          apiKey: 'e-key',
          baseUrl: 'https://e.test',
          model: 'e-model',
        },
      });

      expect(service.createEmbeddingModel()).toBeNull();
    });

    it('returns null when apiKey is missing', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        embedding: {
          apiKey: null,
          baseUrl: 'https://e.test',
          model: 'e-model',
        },
      });

      expect(service.createEmbeddingModel()).toBeNull();
    });

    it('returns an embedding model when fully configured', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        embedding: {
          apiKey: 'e-key',
          baseUrl: 'https://e.test',
          model: 'e-model',
        },
      });

      const model = service.createEmbeddingModel();

      expect(model).toBeDefined();
      expect(model).not.toBeNull();
    });

    it('passes the dimension option when configured', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        embedding: {
          apiKey: 'e-key',
          baseUrl: 'https://e.test',
          model: 'e-model',
          dimension: 768,
        },
      });

      const model = service.createEmbeddingModel();

      expect(model).toBeDefined();
      expect(model).not.toBeNull();
    });
  });

  // ── Runtime config overrides ───────────────────────────────────────────

  describe('runtime config overrides', () => {
    const multiRoleConfig: LlmConfig = {
      ...baseConfig,
      vision: {
        apiKey: 'vision-key',
        baseUrl: 'https://vision.test/v1',
        model: 'vision-model',
        thinking: 'auto',
      },
      language: {
        apiKey: 'language-key',
        baseUrl: 'https://language.test/v1',
        model: 'language-model',
        thinking: 'auto',
      },
      embedding: {
        apiKey: 'embed-key',
        baseUrl: 'https://embed.test/v1',
        model: 'embed-model',
        dimension: 768,
      },
    };

    it('resolves the published model and endpoint for that role only', () => {
      const service = new LlmRuntimeService(
        multiRoleConfig,
        runtimeWith({
          [EnvKey.AI_VISION_MODEL]: 'vision-override',
          [EnvKey.AI_VISION_BASE_URL]: 'https://override.test/v1',
        }),
      );

      const vision = service.createChatModel('vision');

      expect(vision.model).toBe('vision-override');
      expect(vision.clientConfig.baseURL).toBe('https://override.test/v1');
      expect(service.getModelName('vision')).toBe('vision-override');
      expect(service.getModelName('language')).toBe('language-model');
    });

    it('lets the published sampling values win over call-site options', () => {
      const service = new LlmRuntimeService(
        multiRoleConfig,
        runtimeWith({
          [EnvKey.AI_ANALYSIS_TEMPERATURE]: 0.9,
          [EnvKey.AI_ANALYSIS_TIMEOUT_MS]: 12_000,
          [EnvKey.AI_ANALYSIS_MAX_RETRIES]: 4,
        }),
      );

      const analysis = service.createChatModel('analysis', {
        temperature: 0.2,
        timeout: AI_MODEL_TIMEOUT_MS,
        maxRetries: 0,
      });

      expect(analysis.temperature).toBe(0.9);
      expect(analysis.timeout).toBe(12_000);
      expect(chatFields(analysis)['maxRetries']).toBe(4);
    });

    it('keeps a role without a published value on its call-site options', () => {
      const service = new LlmRuntimeService(
        multiRoleConfig,
        runtimeWith({
          [EnvKey.AI_ANALYSIS_TEMPERATURE]: 0.9,
        }),
      );

      const language = service.createChatModel('language', {
        temperature: 0.2,
        timeout: AI_MODEL_TIMEOUT_MS,
      });

      expect(language.temperature).toBe(0.2);
      expect(language.timeout).toBe(AI_MODEL_TIMEOUT_MS);
    });

    it('leaves the provider default alone when neither source sets a value', () => {
      const service = new LlmRuntimeService(multiRoleConfig, runtimeWith({}));

      const model = service.createChatModel('analysis');

      expect(model.temperature).toBeUndefined();
      expect(model.timeout).toBeUndefined();
    });

    it('lets a published thinking mode win over the environment', () => {
      const service = new LlmRuntimeService(
        {
          ...multiRoleConfig,
          analysis: {
            ...multiRoleConfig.analysis,
            baseUrl: 'https://api.deepseek.com',
            thinking: 'enabled',
          },
        },
        runtimeWith({ [EnvKey.AI_ANALYSIS_THINKING]: 'disabled' }),
      );

      expect(service.createChatModel('analysis').modelKwargs).toEqual({
        thinking: { type: 'disabled' },
      });
    });

    it('treats a published model and endpoint as configuration', () => {
      const service = new LlmRuntimeService(
        {
          ...multiRoleConfig,
          analysis: {
            apiKey: 'analysis-key',
            baseUrl: null,
            model: null,
            thinking: 'auto',
          },
        },
        runtimeWith({
          [EnvKey.AI_ANALYSIS_MODEL]: 'published-model',
          [EnvKey.AI_ANALYSIS_BASE_URL]: 'https://published.test/v1',
        }),
      );

      expect(service.hasRoleConfig('analysis')).toBe(true);
    });

    it('never treats a published value as a substitute for the api key', () => {
      // Secrets are env-only: the document whitelist has no AI_*_API_KEY, so a
      // role without one stays unconfigured no matter what the center says.
      const service = new LlmRuntimeService(
        {
          ...multiRoleConfig,
          analysis: {
            apiKey: null,
            baseUrl: null,
            model: null,
            thinking: 'auto',
          },
        },
        runtimeWith({
          [EnvKey.AI_ANALYSIS_MODEL]: 'published-model',
          [EnvKey.AI_ANALYSIS_BASE_URL]: 'https://published.test/v1',
        }),
      );

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('overrides the embedding model and endpoint but keeps the dimension', () => {
      const service = new LlmRuntimeService(
        multiRoleConfig,
        runtimeWith({
          [EnvKey.AI_EMBEDDING_MODEL]: 'embed-override',
          [EnvKey.AI_EMBEDDING_BASE_URL]: 'https://embed-override.test/v1',
        }),
      );

      const model = service.createEmbeddingModel();

      const clientConfig = (
        model as unknown as { clientConfig: { baseURL?: string } }
      ).clientConfig;

      expect(model?.model).toBe('embed-override');
      expect(clientConfig.baseURL).toBe('https://embed-override.test/v1');
      expect(service.embeddingDimension).toBe(768);
    });
  });
});
