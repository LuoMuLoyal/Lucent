import { z } from 'zod';
import { BaseLlmGeneratorService } from './base-llm-generator.service';
import type { LlmRuntimePort, LlmRole } from './llm-runtime.port';
import type { MetricsService } from '../metrics/metrics.service';

// ── Test fixture ───────────────────────────────────────────────────────────

interface TestContext {
  input: string;
}

interface TestPromptCopy {
  label: string;
}

const testSchema = z.object({
  summary: z.string(),
  result: z.string(),
});

type TestOutput = z.infer<typeof testSchema>;

class TestGeneratorService extends BaseLlmGeneratorService<
  TestContext,
  TestPromptCopy,
  TestOutput
> {
  protected readonly schema = testSchema;
  protected readonly options = {
    toolName: 'test_tool',
    streamName: 'test-stream',
  };
  protected readonly modelRole: LlmRole = 'analysis';

  protected buildSystemPrompt(): string {
    return 'You are a test assistant.';
  }

  protected buildUserPrompt(
    context: TestContext,
    copy: TestPromptCopy,
  ): string {
    return `${copy.label}: ${context.input}`;
  }
}

// ── Mocks ──────────────────────────────────────────────────────────────────

function createMocks() {
  const mockModel = {
    invoke: jest.fn(),
    stream: jest.fn(),
    withStructuredOutput: jest.fn().mockReturnThis(),
    withConfig: jest.fn().mockReturnThis(),
  };

  const llmRuntimeService: jest.Mocked<LlmRuntimePort> = {
    hasRoleConfig: jest.fn().mockReturnValue(true),
    createChatModel: jest.fn().mockReturnValue(mockModel),
    getModelName: jest.fn().mockReturnValue('test-model'),
  };

  const metricsService = {
    recordLlmCall: jest.fn(),
  } as unknown as jest.Mocked<MetricsService>;

  return { mockModel, llmRuntimeService, metricsService };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BaseLlmGeneratorService', () => {
  let service: TestGeneratorService;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    service = new TestGeneratorService(
      mocks.llmRuntimeService,
      mocks.metricsService,
    );
  });

  describe('hasAnalysisModel', () => {
    it('returns true when role is configured', () => {
      mocks.llmRuntimeService.hasRoleConfig.mockReturnValue(true);
      expect(service.hasAnalysisModel()).toBe(true);
    });

    it('returns false when role is not configured', () => {
      mocks.llmRuntimeService.hasRoleConfig.mockReturnValue(false);
      expect(service.hasAnalysisModel()).toBe(false);
    });
  });

  describe('generate', () => {
    it('returns structured output on success', async () => {
      const output: TestOutput = { summary: 'ok', result: 'done' };
      mocks.mockModel.invoke.mockResolvedValue(output);

      const result = await service.generate(
        { input: 'hello' },
        { label: 'Input' },
      );

      expect(result).toEqual(output);
      expect(mocks.mockModel.invoke).toHaveBeenCalledTimes(1);
      expect(mocks.metricsService.recordLlmCall).toHaveBeenCalledWith(
        'analysis',
        'test-model',
        'success',
        expect.any(Number),
      );
    });

    it('records error metric on failure', async () => {
      mocks.mockModel.invoke.mockRejectedValue(new Error('LLM error'));

      await expect(
        service.generate({ input: 'hello' }, { label: 'Input' }),
      ).rejects.toThrow('LLM error');

      expect(mocks.metricsService.recordLlmCall).toHaveBeenCalledWith(
        'analysis',
        'test-model',
        'error',
        expect.any(Number),
      );
    });
  });

  describe('generateStream', () => {
    it('throws when stream produces no chunks', async () => {
      mocks.mockModel.stream.mockResolvedValue([]);

      await expect(
        service.generateStream(
          { input: 'hello' },
          { label: 'Input' },
          jest.fn(),
        ),
      ).rejects.toThrow('stream ended without any message chunks');

      expect(mocks.metricsService.recordLlmCall).toHaveBeenCalledWith(
        'analysis',
        'test-model',
        'error',
        expect.any(Number),
      );
    });

    it('throws when stream produces null result', async () => {
      // Create a mock AIMessageChunk-like object
      const mockChunk = {
        content: '',
        concat: jest.fn().mockReturnThis(),
      };

      mocks.mockModel.stream.mockResolvedValue([mockChunk]);

      // The parser will fail to produce a result, so we expect an error
      await expect(
        service.generateStream(
          { input: 'hello' },
          { label: 'Input' },
          jest.fn(),
        ),
      ).rejects.toThrow();
    });
  });
});
