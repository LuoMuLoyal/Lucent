import { Test } from '@nestjs/testing';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { DailyRecordCandidatesGeneratorService } from '../candidates/generator.service.js';

interface GeneratorInternals {
  modelRole: string;
  options: { toolName: string; streamName: string };
  buildSystemPrompt(): string;
  buildUserPrompt(context: unknown, copy: { language: string }): string;
}

describe('DailyRecordCandidatesGeneratorService', () => {
  let service: DailyRecordCandidatesGeneratorService;
  let internals: GeneratorInternals;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DailyRecordCandidatesGeneratorService,
        {
          provide: LlmRuntimeService,
          useValue: {
            hasRoleConfig: vi.fn(),
            getModelName: vi.fn().mockReturnValue('test-model'),
          },
        },
        {
          provide: MetricsService,
          useValue: { recordLlmCall: vi.fn() },
        },
        {
          provide: LlmCircuitBreakerService,
          useValue: new LlmCircuitBreakerService(),
        },
      ],
    }).compile();

    service = module.get(DailyRecordCandidatesGeneratorService);
    internals = service as unknown as GeneratorInternals;
  });

  it('configures the language model role', () => {
    expect(internals.modelRole).toBe('language');
  });

  it('configures the tool naming options', () => {
    expect(internals.options.toolName).toBe('DailyRecordCandidates');
    expect(internals.options.streamName).toBe('Daily record candidates');
  });

  it('builds a non-empty system prompt', () => {
    const prompt = internals.buildSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('builds a user prompt from context and copy', () => {
    const prompt = internals.buildUserPrompt({}, { language: 'zh' });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
