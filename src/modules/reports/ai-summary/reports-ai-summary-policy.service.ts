import { Injectable } from '@nestjs/common';
import type { ReportSummaryStructuredOutput } from './report-summary.schema';

const FORBIDDEN_PATTERNS = [
  /诊断/u,
  /确诊/u,
  /停药/u,
  /减药/u,
  /加药/u,
  /增量/u,
  /减量/u,
  /剂量/u,
  /药量/u,
  /处方/u,
  /治愈/u,
  /治疗方案/u,
  /\bdiagnos(?:e|is|ed|ing)\b/iu,
  /\bprescription\b/iu,
  /\bcure\b/iu,
  /\btreatment plan\b/iu,
  /\bstop(?:ping)? medication\b/iu,
  /\bchange (?:the )?dose\b/iu,
  /\badjust(?:ing)? (?:the )?dose\b/iu,
  /\bincrease(?:ing)? (?:the )?dose\b/iu,
  /\bdecrease(?:ing)? (?:the )?dose\b/iu,
  /\bdosage\b/iu,
];

@Injectable()
export class ReportsAiSummaryPolicyService {
  isSafe(output: ReportSummaryStructuredOutput): boolean {
    const texts = [
      output.summary,
      ...output.bullets.map((bullet) => bullet.text),
    ];

    return texts.every((text) => this.isSafeText(text));
  }

  isSafeSummaryText(text: string): boolean {
    return text.trim().length > 0 && this.isSafeText(text);
  }

  private isSafeText(text: string): boolean {
    return !FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
  }
}
