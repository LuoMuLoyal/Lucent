import { AnalysisController } from './adapters/http/controllers/analysis.controller.js';
import { analysisReadDataSchema } from './adapters/http/dto/analysis-response.js';

describe('AnalysisController OpenAPI contract', () => {
  const responsesFor = (method: keyof AnalysisController) =>
    Reflect.getMetadata(
      'swagger/apiResponse',
      AnalysisController.prototype[method],
    ) as Record<string, { type?: unknown; schema?: unknown }> | undefined;

  const serializeOptionsFor = (method: keyof AnalysisController) =>
    Reflect.getMetadata(
      'class_serializer:options',
      AnalysisController.prototype[method],
    ) as { schema?: unknown } | undefined;

  it('wires the read endpoint to the zod response schema', () => {
    expect(serializeOptionsFor('read')?.schema).toBe(
      analysisReadDataSchema,
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
      '#/components/schemas/AnalysisData',
      '#/components/schemas/AnalysisReadData',
      '#/components/schemas/AnalysisRefreshPendingData',
      '#/components/schemas/AnalysisRefreshReadyData',
    ]);

    expect(responsesFor('generate')?.['200']?.type).toBeUndefined();
    expect(oneOfRefs(responsesFor('generate')?.['200']?.schema)).toEqual([
      '#/components/schemas/AnalysisData',
      '#/components/schemas/AnalysisReadData',
    ]);

    expect(responsesFor('generateAsync')?.['202']?.type).toBeUndefined();
    expect(oneOfRefs(responsesFor('generateAsync')?.['202']?.schema)).toEqual([
      '#/components/schemas/AnalysisAsyncJobData',
      '#/components/schemas/AnalysisAsyncResultData',
      '#/components/schemas/AnalysisAsyncStatusData',
    ]);
  });
});
