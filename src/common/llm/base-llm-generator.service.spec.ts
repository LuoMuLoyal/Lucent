import { AIMessageChunk } from '@langchain/core/messages';
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

/** Creates a real AIMessageChunk with tool_calls set. */
function makeChunk(
  toolName: string,
  args: Record<string, unknown>,
): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    tool_calls: [{ name: toolName, args }],
  });
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
    it('streams summary updates and returns parsed result', async () => {
      // Single chunk with complete tool call args
      const chunk = makeChunk('test_tool', {
        summary: 'partial summary',
        result: 'final result',
      });
      mocks.mockModel.stream.mockResolvedValue([chunk]);

      const onSummary = jest.fn();
      const result = await service.generateStream(
        { input: 'hello' },
        { label: 'Input' },
        onSummary,
      );

      expect(result).toEqual({
        summary: 'partial summary',
        result: 'final result',
      });
      // onSummary should have been called with the non-empty summary
      expect(onSummary).toHaveBeenCalledWith('partial summary');
      expect(mocks.metricsService.recordLlmCall).toHaveBeenCalledWith(
        'analysis',
        'test-model',
        'success',
        expect.any(Number),
      );
    });

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
      // A chunk with no tool_calls → parser returns undefined
      const mockChunk = {
        content: '',
        concat: jest.fn().mockReturnThis(),
      };

      mocks.mockModel.stream.mockResolvedValue([mockChunk]);

      await expect(
        service.generateStream(
          { input: 'hello' },
          { label: 'Input' },
          jest.fn(),
        ),
      ).rejects.toThrow();
    });

    it('records error metric when model.stream rejects', async () => {
      mocks.mockModel.stream.mockRejectedValue(new Error('stream error'));

      await expect(
        service.generateStream(
          { input: 'hello' },
          { label: 'Input' },
          jest.fn(),
        ),
      ).rejects.toThrow('stream error');

      expect(mocks.metricsService.recordLlmCall).toHaveBeenCalledWith(
        'analysis',
        'test-model',
        'error',
        expect.any(Number),
      );
    });

    it('skips chunks that are not AIMessageChunk instances', async () => {
      // First chunk is a plain object (not AIMessageChunk) — should be skipped
      // Second chunk is a real AIMessageChunk with valid tool_calls
      const validChunk = makeChunk('test_tool', {
        summary: 'valid',
        result: 'data',
      });
      const plainObject = { content: 'not a chunk' };

      mocks.mockModel.stream.mockResolvedValue([plainObject, validChunk]);

      const onSummary = jest.fn();
      const result = await service.generateStream(
        { input: 'hello' },
        { label: 'Input' },
        onSummary,
      );

      expect(result).toEqual({ summary: 'valid', result: 'data' });
      expect(onSummary).toHaveBeenCalledWith('valid');
    });

    it('does not call onSummary for whitespace-only summaries', async () => {
      const chunk = makeChunk('test_tool', {
        summary: '   ',
        result: 'data',
      });
      mocks.mockModel.stream.mockResolvedValue([chunk]);

      const onSummary = jest.fn();
      const result = await service.generateStream(
        { input: 'hello' },
        { label: 'Input' },
        onSummary,
      );

      expect(result).toEqual({ summary: '   ', result: 'data' });
      // The summary is whitespace-only → trimmed length is 0 → onSummary not called
      expect(onSummary).not.toHaveBeenCalled();
    });

    it('deduplicates identical consecutive summaries', async () => {
      // Two chunks with the same summary — onSummary should be called once
      const chunk1 = makeChunk('test_tool', {
        summary: 'same summary',
        result: 'partial',
      });
      const chunk2 = makeChunk('test_tool', {
        summary: 'same summary',
        result: 'final',
      });
      mocks.mockModel.stream.mockResolvedValue([chunk1, chunk2]);

      const onSummary = jest.fn();
      const result = await service.generateStream(
        { input: 'hello' },
        { label: 'Input' },
        onSummary,
      );

      // The final result comes from the first tool_call (due to concat behavior)
      expect(result).toEqual({ summary: 'same summary', result: 'partial' });
      // onSummary should only be called once (first time), not again for the duplicate
      expect(onSummary).toHaveBeenCalledTimes(1);
      expect(onSummary).toHaveBeenCalledWith('same summary');
    });

    it('throws when parser validates result and zod schema rejects it', async () => {
      // The JsonOutputKeyToolsParser is constructed with zodSchema, so it validates
      // the result itself. A result missing the required 'result' field will cause
      // the parser to throw an OutputParserException before schema.parse is reached.
      const chunk = makeChunk('test_tool', {
        summary: 'has summary',
        // missing 'result' field → parser's zodSchema validation fails
      });
      mocks.mockModel.stream.mockResolvedValue([chunk]);

      await expect(
        service.generateStream(
          { input: 'hello' },
          { label: 'Input' },
          jest.fn(),
        ),
      ).rejects.toThrow();
    });

    it('throws when stream ends without a structured result', async () => {
      // A chunk that is a real AIMessageChunk but has no tool_calls
      const chunk = new AIMessageChunk({ content: 'some content' });
      mocks.mockModel.stream.mockResolvedValue([chunk]);

      await expect(
        service.generateStream(
          { input: 'hello' },
          { label: 'Input' },
          jest.fn(),
        ),
      ).rejects.toThrow('stream ended without a structured result');

      expect(mocks.metricsService.recordLlmCall).toHaveBeenCalledWith(
        'analysis',
        'test-model',
        'error',
        expect.any(Number),
      );
    });
  });
});
