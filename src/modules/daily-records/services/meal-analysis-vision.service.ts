import { Injectable } from '@nestjs/common';
import { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';

export interface MealVisionRecognitionResult {
  mealDescription: string | null;
  foodItems: Array<{
    name: string;
    confidence: number | null;
    portionText: string | null;
  }>;
}

@Injectable()
export class MealAnalysisVisionService {
  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  isConfigured(): boolean {
    return this.llmRuntimeService.hasRoleConfig('vision');
  }

  recognizeFromImageUrl(
    _imageUrl: string,
  ): Promise<MealVisionRecognitionResult> {
    return Promise.resolve({
      mealDescription: null,
      foodItems: [],
    });
  }
}
