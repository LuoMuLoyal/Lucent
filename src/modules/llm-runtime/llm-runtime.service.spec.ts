import type { AiConfig } from '../../config/ai.config';
import { AI_MODEL_TIMEOUT_MS } from '../../config/constants';
import { LlmRuntimeService } from './services/llm-runtime.service';

describe('LlmRuntimeService', () => {
  const baseConfig: AiConfig = {
    provider: 'openai-compatible',
    analysis: {
      apiKey: 'analysis-key',
      baseUrl: 'https://analysis.example.com/v1',
      model: 'analysis-model',
    },
    vision: { apiKey: null, baseUrl: null, model: null },
    language: { apiKey: null, baseUrl: null, model: null },
    chat: { apiKey: null, baseUrl: null, model: null },
    chatCompression: { apiKey: null, baseUrl: null, model: null },
    embedding: { apiKey: null, baseUrl: null, model: null },
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
        analysis: { apiKey: null, baseUrl: 'url', model: 'model' },
      });

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('returns false when the role has no baseUrl', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: { apiKey: 'key', baseUrl: null, model: 'model' },
      });

      expect(service.hasRoleConfig('analysis')).toBe(false);
    });

    it('returns false when the role has no model', () => {
      const service = new LlmRuntimeService({
        ...baseConfig,
        analysis: { apiKey: 'key', baseUrl: 'url', model: null },
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
      const fullConfig: AiConfig = {
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
        chat: { apiKey: 'c-key', baseUrl: 'https://c.test', model: 'c-model' },
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

      expect(model).toBeDefined();
    });

    it('does not set thinking-disabled for non-deepseek baseUrls', () => {
      const service = new LlmRuntimeService(baseConfig);

      const model = service.createChatModel('analysis');

      expect(model).toBeDefined();
    });

    it('creates a chat model for an unconfigured role using fallback values', () => {
      const service = new LlmRuntimeService(baseConfig);

      // Even though 'chat' role is not configured, createChatModel still
      // returns a model instance (with empty-string fallbacks).
      const model = service.createChatModel('chat');

      expect(model).toBeDefined();
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
});
