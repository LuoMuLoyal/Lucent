import { TodayAnalysisController } from './today-analysis.controller';
import {
  TodayAnalysisAsyncResponseDto,
  TodayAnalysisGenerateResponseDto,
  TodayAnalysisReadResponseDto,
  TodayAnalysisRefreshResponseDto,
} from './dto/analysis-response.dto';

describe('TodayAnalysisController OpenAPI contract', () => {
  const responsesFor = (method: keyof TodayAnalysisController) =>
    Reflect.getMetadata(
      'swagger/apiResponse',
      TodayAnalysisController.prototype[method],
    ) as Record<string, { type?: unknown; schema?: unknown }> | undefined;

  it('documents the read endpoint as an API envelope with read data', () => {
    expect(responsesFor('read')?.['200']?.type).toBe(
      TodayAnalysisReadResponseDto,
    );
  });

  it('documents refresh, generate, and async data unions explicitly', () => {
    expect(responsesFor('refresh')?.['201']?.type).toBe(
      TodayAnalysisRefreshResponseDto,
    );
    expect(responsesFor('generate')?.['200']?.type).toBe(
      TodayAnalysisGenerateResponseDto,
    );
    expect(responsesFor('generateAsync')?.['202']?.type).toBe(
      TodayAnalysisAsyncResponseDto,
    );
  });
});
