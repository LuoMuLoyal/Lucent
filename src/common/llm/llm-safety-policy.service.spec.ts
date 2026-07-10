import { LlmSafetyPolicyService } from './llm-safety-policy.service';

describe('LlmSafetyPolicyService', () => {
  function createService(
    forbiddenPatterns: string[] = [],
  ): LlmSafetyPolicyService {
    return new LlmSafetyPolicyService({
      safety: { forbiddenPatterns },
    } as never);
  }

  describe('with default patterns', () => {
    let service: LlmSafetyPolicyService;

    beforeEach(() => {
      service = createService([]);
    });

    describe('isSafeText', () => {
      it('returns true for safe Chinese text', () => {
        expect(service.isSafeText('今天天气很好')).toBe(true);
      });

      it('returns true for safe English text', () => {
        expect(service.isSafeText('Have a nice day')).toBe(true);
      });

      it('returns false for text containing 诊断', () => {
        expect(service.isSafeText('请给出诊断结果')).toBe(false);
      });

      it('returns false for text containing 确诊', () => {
        expect(service.isSafeText('患者已确诊')).toBe(false);
      });

      it('returns false for text containing 停药', () => {
        expect(service.isSafeText('建议停药')).toBe(false);
      });

      it('returns false for text containing 处方', () => {
        expect(service.isSafeText('这是处方信息')).toBe(false);
      });

      it('returns false for English diagnosis', () => {
        expect(service.isSafeText('The diagnosis is clear')).toBe(false);
      });

      it('returns false for English prescription', () => {
        expect(service.isSafeText('Here is your prescription')).toBe(false);
      });

      it('returns false for English dosage', () => {
        expect(service.isSafeText('Adjust the dosage accordingly')).toBe(false);
      });

      it('returns false for stop medication', () => {
        expect(service.isSafeText('You should stop medication now')).toBe(
          false,
        );
      });
    });

    describe('isSafe', () => {
      it('returns true when all texts are safe', () => {
        expect(service.isSafe(['safe text 1', 'safe text 2'])).toBe(true);
      });

      it('returns false when any text is unsafe', () => {
        expect(service.isSafe(['safe text', '包含诊断的内容'])).toBe(false);
      });

      it('returns true for empty array', () => {
        expect(service.isSafe([])).toBe(true);
      });
    });

    describe('isSafeSummaryText', () => {
      it('returns true for safe non-empty text', () => {
        expect(service.isSafeSummaryText('这是一个安全的摘要')).toBe(true);
      });

      it('returns false for empty string', () => {
        expect(service.isSafeSummaryText('')).toBe(false);
      });

      it('returns false for whitespace-only string', () => {
        expect(service.isSafeSummaryText('   ')).toBe(false);
      });

      it('returns false for unsafe text', () => {
        expect(service.isSafeSummaryText('建议停药观察')).toBe(false);
      });
    });
  });

  describe('with custom patterns', () => {
    it('uses custom patterns when provided', () => {
      const service = createService(['forbidden_word']);
      expect(service.isSafeText('this is fine')).toBe(true);
      expect(service.isSafeText('this has forbidden_word')).toBe(false);
    });

    it('custom patterns are case-insensitive', () => {
      const service = createService(['secret']);
      expect(service.isSafeText('This is SECRET')).toBe(false);
      expect(service.isSafeText('This is secret')).toBe(false);
    });

    it('does not use default patterns when custom patterns are provided', () => {
      const service = createService(['custom_only']);
      // 诊断 would be blocked by default patterns, but with custom patterns it should pass
      expect(service.isSafeText('包含诊断的内容')).toBe(true);
      expect(service.isSafeText('custom_only is here')).toBe(false);
    });
  });
});
