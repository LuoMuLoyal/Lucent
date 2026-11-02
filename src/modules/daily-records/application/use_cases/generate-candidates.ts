/**
 * 生成日报候选（用例）。
 *
 * ## 流程
 *
 * 1. 语言归一（文案语言与模型语言共用）
 * 2. 没有可用模型 → 503（**不是**降级：让客户端知道能力不可用）
 * 3. 调模型；失败（网络/契约）→ 记日志并返回兜底候选
 *
 * ## 依赖方向
 *
 * 只依赖应用层端口（`CandidateGenerator` / `CandidateCopy`）；实现在
 * `infrastructure/llm/`（模型）与 `application/services/candidate-copy.ts`（文案，
 * 纯字符串拼接，无 IO）。
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { nowIsoString, extractErrorInfo } from '../../../../common/index.js';
import type { GenerateCandidatesInput } from '../ports/record-candidates.js';
import type { DailyRecordCandidateData } from '../ports/record-candidates.js';
import { CandidateCopyPort } from '../ports/candidate-generator.js';
import { CandidateGenerator } from '../ports/candidate-generator.js';

interface DailyRecordCandidatesContext {
  text: string;
  occurredAt: string;
  timezone: string | null;
}

@Injectable()
export class DailyRecordCandidatesService {
  private readonly logger = new Logger(DailyRecordCandidatesService.name);

  constructor(
    private readonly copyService: CandidateCopyPort,
    private readonly generatorService: CandidateGenerator,
  ) {}

  async generate(
    userId: string,
    dto: GenerateCandidatesInput,
    language: string,
  ): Promise<DailyRecordCandidateData> {
    const locale = this.copyService.resolveLocale(language);

    if (!this.generatorService.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: this.copyService.serviceUnavailable(locale),
      });
    }

    const context = this.buildContext(dto);

    try {
      const output = await this.generatorService.generate(context, locale);

      return {
        locale,
        generatedAt: nowIsoString(),
        confirmationHint: this.copyService.confirmationHint(locale),
        items: output.items,
      };
    } catch (error) {
      const { message: reason } = extractErrorInfo(error);
      this.logger.warn(
        `Daily record candidate generation failed for userId=${userId}, occurredAt=${dto.occurredAt}; falling back: ${reason}`,
      );

      return this.copyService.buildFallback(dto.text, dto.occurredAt, locale);
    }
  }

  private buildContext(
    dto: GenerateCandidatesInput,
  ): DailyRecordCandidatesContext {
    return {
      text: dto.text.trim(),
      occurredAt: dto.occurredAt,
      timezone: dto.timezone?.trim() || null,
    };
  }
}
