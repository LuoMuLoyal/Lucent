import { LlmRuntimeModule } from './llm-runtime.module';
import { LlmRuntimeService } from './services/llm-runtime.service';

describe('LlmRuntimeModule', () => {
  it('is a valid NestJS module', () => {
    expect(LlmRuntimeModule).toBeDefined();
    expect(typeof LlmRuntimeModule).toBe('function');
  });

  it('registers LlmRuntimeService as a provider', () => {
    const providers = Reflect.getMetadata('providers', LlmRuntimeModule);
    expect(providers).toBeDefined();
    expect(providers).toContain(LlmRuntimeService);
  });

  it('exports LlmRuntimeService so other modules can inject it', () => {
    const exports = Reflect.getMetadata('exports', LlmRuntimeModule);
    expect(exports).toBeDefined();
    expect(exports).toContain(LlmRuntimeService);
  });
});
