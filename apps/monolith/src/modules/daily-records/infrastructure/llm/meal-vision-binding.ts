/**
 * 视觉分析端口的 Prisma/LLM 实现桥接。
 *
 * `MealVisionModel`（应用层端口）与既有 `MealAnalysisVisionService`（基础设施实现）
 * 之间只差一层 `extends`：实现保留在 `meal-vision.ts`（含 prompt 渲染、结构化输出、
 * 安全过滤与失败分类），这里只声明它满足端口。
 */
import { Injectable } from '@nestjs/common';
import { MealVisionModel } from '../../application/ports/meal-vision.js';
import { MealAnalysisVisionService } from './meal-vision.js';

@Injectable()
export class PrismaLlmMealVision extends MealVisionModel {
  constructor(private readonly vision: MealAnalysisVisionService) {
    super();
  }

  isConfigured(): boolean {
    return this.vision.isConfigured();
  }

  analyze(input: { imageUrl: string; locale: string }) {
    return this.vision.analyze(input);
  }
}
