import { TodayAnalysisController } from './today-analysis.controller.js';
import { TodayAnalysisReadResponseDto } from './dto/analysis-response.dto.js';

describe('TodayAnalysisController OpenAPI contract', () => {
  const responsesFor = (method: keyof TodayAnalysisController) =>
    Reflect.getMetadata(
      'swagger/apiResponse',
      TodayAnalysisController.prototype[method],
    ) as Record<string, { type?: unknown; schema?: unknown }> | undefined;

  it('documents the read endpoint as direct read data', () => {
    expect(responsesFor('read')?.['200']?.type).toBe(
      TodayAnalysisReadResponseDto,
    );
  });

  it('documents refresh, generate, and async direct unions explicitly', () => {
    expect(responsesFor('refresh')?.['201']?.schema).toMatchObject({
      oneOf: expect.any(Array),
    });
    expect(responsesFor('generate')?.['200']?.schema).toMatchObject({
      oneOf: expect.any(Array),
    });
    expect(responsesFor('generateAsync')?.['202']?.schema).toMatchObject({
      oneOf: expect.any(Array),
    });
  });
});
