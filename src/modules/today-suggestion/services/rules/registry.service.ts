import { Injectable } from '@nestjs/common';
import type { SuggestionRule } from '../../types/rule.types.js';

/**
 * Registry for all suggestion rules.
 * Rules are registered at module construction time and
 * invoked by the suggestion orchestrator for each signal bundle.
 */
@Injectable()
export class RegistryService {
  private readonly rules = new Map<string, SuggestionRule>();

  register(rule: SuggestionRule): void {
    if (this.rules.has(rule.ruleId)) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- 启动阶段不变式违反，ApiExceptionFilter 尚未就绪
      throw new Error(`Duplicate suggestion rule: ${rule.ruleId}`);
    }
    this.rules.set(rule.ruleId, rule);
  }

  getAll(): SuggestionRule[] {
    return Array.from(this.rules.values());
  }

  getById(ruleId: string): SuggestionRule | undefined {
    return this.rules.get(ruleId);
  }
}
