import { z } from 'zod';

/**
 * zod 4 Standard Schemas for the `POST /medicines/recognize/async` response.
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases). The recognition result fields are always
 * present, holding `null` when the LLM could not extract a value. Exactly one
 * of `jobId` / `result` is present on the wire — both stay optional so the
 * queue-first / synchronous-fallback shapes both validate.
 */

export const medicineRecognitionResultSchema = z.object({
  name: z.string().nullable().describe('Recognized medicine name.'),
  approvalNumber: z.string().nullable().describe('Approval number.'),
  specification: z.string().nullable().describe('Package specification.'),
  manufacturer: z.string().nullable().describe('Manufacturer.'),
});

export const medicineRecognitionAsyncResponseSchema = z.object({
  jobId: z.string().optional().describe('Queued recognition job identifier.'),
  result: medicineRecognitionResultSchema
    .optional()
    .describe(
      'Inline recognition resource when queue processing is unavailable.',
    ),
});

/**
 * zod 4 Standard Schema for the synchronous `POST /medicines/recognize`
 * response: the recognition resource itself, with no job wrapper. Aliased to
 * the same object so the inline and queued-fallback shapes can never drift.
 */
export const medicineRecognitionResponseSchema =
  medicineRecognitionResultSchema;

/** Inline recognition resource when the queue is unavailable. */
export type MedicineRecognitionResultDto = z.infer<
  typeof medicineRecognitionResultSchema
>;

/** Exactly one of `jobId` and `result` is present in the response. */
export type MedicineRecognitionAsyncResponseDto = z.infer<
  typeof medicineRecognitionAsyncResponseSchema
>;

/** Recognition resource returned by the synchronous endpoint. */
export type MedicineRecognitionResponseDto = MedicineRecognitionResultDto;
