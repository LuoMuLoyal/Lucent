/**
 * 候选生成端口的实现绑定。
 *
 * `DailyRecordCandidatesGeneratorService` 继承 `BaseLlmGeneratorService`，它的
 * `generate(context, promptCopy)` 需要**文案对象**（prompt 渲染是基础设施细节），
 * 而应用层端口只认识 `locale`。这层绑定做两件事：
 *
 * 1. 把 `hasAnalysisModel()` 暴露成端口的 `isConfigured()`；
 * 2. 用 locale 构造文案对象，再调用底层生成器。
 *
 * 这样应用层不必知道 prompt 长什么样，也不用 import `LocalizedCopyService`。
 */
import { Injectable } from '@nestjs/common';
import {
  CandidateGenerator,
  type CandidateGenerationContext,
  type CandidateGenerationResult,
} from '../../application/ports/candidate-generator.js';
import { DailyRecordCandidatesCopyService } from '../../application/services/candidate-copy.js';
import { DailyRecordCandidatesGeneratorService } from './candidate-generator.js';

@Injectable()
export class BoundCandidateGenerator extends CandidateGenerator {
  constructor(
    private readonly generator: DailyRecordCandidatesGeneratorService,
    private readonly copy: DailyRecordCandidatesCopyService,
  ) {
    super();
  }

  isConfigured(): boolean {
    return this.generator.hasAnalysisModel();
  }

  async generate(
    context: CandidateGenerationContext,
    locale: string,
  ): Promise<CandidateGenerationResult> {
    const output = await this.generator.generate(
      context,
      this.copy.buildPromptCopy(locale),
    );
    return { items: output.items };
  }
}
