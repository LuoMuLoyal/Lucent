import type { AiConfig } from '../../config/ai.config';
import { LlmRuntimeService } from './llm-runtime.service';

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
});
