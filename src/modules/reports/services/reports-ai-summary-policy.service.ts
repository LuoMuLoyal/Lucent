import { Injectable } from '@nestjs/common';
import { AiSafetyPolicyService } from '../../../common/ai/ai-safety-policy.service';
import type { ReportSummaryStructuredOutput } from '../schemas/report-summary.schema';

@Injectable()
export class ReportsAiSummaryPolicyService {
  constructor(private readonly policy: AiSafetyPolicyService) {}

  isSafe(output: ReportSummaryStructuredOutput): boolean {
    const texts = [
      output.summary,
      ...output.bullets.map((bullet) => bullet.text),
    ];

    return this.policy.isSafe(texts);
  }

  isSafeSummaryText(text: string): boolean {
    return this.policy.isSafeSummaryText(text);
  }
}
