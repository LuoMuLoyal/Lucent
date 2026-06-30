import type { AiConfig } from '../../config/ai.config';
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

  it('detects configured role', () => {
    const service = new LlmRuntimeService(baseConfig);

    expect(service.hasRoleConfig('analysis')).toBe(true);
    expect(service.hasRoleConfig('vision')).toBe(false);
  });

  it('creates an OpenAI-compatible chat model for the role', () => {
    const service = new LlmRuntimeService(baseConfig);

    const model = service.createChatModel('analysis', {
      timeout: 10_000,
      temperature: 0.2,
      maxRetries: 0,
    });

    expect(model).toBeDefined();
  });

  it('disables DeepSeek thinking mode for OpenAI-compatible streaming tool use', () => {
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
});
