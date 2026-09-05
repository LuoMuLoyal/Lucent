import { TodayAnalysisController } from './today-analysis.controller.js';
import { todayAnalysisReadDataSchema } from './dto/analysis-response.dto.js';

describe('TodayAnalysisController OpenAPI contract', () => {
  const responsesFor = (method: keyof TodayAnalysisController) =>
    Reflect.getMetadata(
      'swagger/apiResponse',
      TodayAnalysisController.prototype[method],
    ) as Record<string, { type?: unknown; schema?: unknown }> | undefined;

  const serializeOptionsFor = (method: keyof TodayAnalysisController) =>
    Reflect.getMetadata(
      'class_serializer:options',
      TodayAnalysisController.prototype[method],
    ) as { schema?: unknown } | undefined;

  it('wires the read endpoint to the zod response schema', () => {
    expect(serializeOptionsFor('read')?.schema).toBe(
      todayAnalysisReadDataSchema,
    );
    // The former class-based `type` is gone; the schema is carried by
    // `@SerializeOptions` and registered in the response-schema registry.
    expect(responsesFor('read')?.['200']?.type).toBeUndefined();
  });

  it('keeps the polymorphic union docs for refresh, generate, and async with stable member $refs', () => {
    const oneOfRefs = (schema: unknown): unknown => {
      const branches = (
        schema as { oneOf?: Array<{ $ref: string }> } | undefined
      )?.oneOf;
      return branches?.map((branch) => branch.$ref);
    };

    expect(responsesFor('refresh')?.['201']?.type).toBeUndefined();
    expect(oneOfRefs(responsesFor('refresh')?.['201']?.schema)).toEqual([
      '#/components/schemas/TodayAnalysisData',
      '#/components/schemas/TodayAnalysisReadData',
      '#/components/schemas/TodayAnalysisRefreshPendingData',
      '#/components/schemas/TodayAnalysisRefreshReadyData',
    ]);

    expect(responsesFor('generate')?.['200']?.type).toBeUndefined();
    expect(oneOfRefs(responsesFor('generate')?.['200']?.schema)).toEqual([
      '#/components/schemas/TodayAnalysisData',
      '#/components/schemas/TodayAnalysisReadData',
    ]);

    expect(responsesFor('generateAsync')?.['202']?.type).toBeUndefined();
    expect(oneOfRefs(responsesFor('generateAsync')?.['202']?.schema)).toEqual([
      '#/components/schemas/TodayAnalysisAsyncJobData',
      '#/components/schemas/TodayAnalysisAsyncResultData',
      '#/components/schemas/TodayAnalysisAsyncStatusData',
    ]);
  });
});
