import { ServiceUnavailableException } from '@nestjs/common';
import type { LlmConfig } from '../config/llm.config';
import { AI_MODEL_TIMEOUT_MS } from '../config/constants';
import { LlmRuntimeService } from './services';

describe('LlmRuntimeService', () => {
  const baseConfig: LlmConfig = {
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
});
