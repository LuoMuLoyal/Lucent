import { Injectable } from '@nestjs/common';
import { AiSafetyPolicyService } from '../../../common/ai/ai-safety-policy.service';
import type { TodayAnalysisStructuredOutput } from '../schemas/today-analysis.schema';

@Injectable()
export class TodayAnalysisPolicyService {
  constructor(private readonly policy: AiSafetyPolicyService) {}

  isSafe(output: TodayAnalysisStructuredOutput): boolean {
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
