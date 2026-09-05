import type { z } from 'zod';

/**
 * Central registry of response schemas that should be documented as named
 * OpenAPI components and referenced from their operation responses.
 *
 * The request-side migration switched bodies/queries to zod Standard Schemas,
 * and `StandardSchemaSerializerInterceptor` consumes response schemas from
 * `@SerializeOptions({ schema })` — but Swagger does not introspect that
 * decorator. `scripts/contract/export-openapi.ts` reads this registry after
 * `createDocument` and (1) registers each schema as a component under its
 * semantic `componentName` and (2) points the operation's 200 response at
 * the component.
 *
 * **Naming convention (2026-09-05 naming reform, AIP-190/136):** component
 * names are semantic PascalCase without a `Dto` suffix — resources use
 * `*Response` / `*Data` (`AccountResponse`, `DailyRecordListResponse`,
 * `TodayAnalysisData`), async jobs use `*JobResponse`
 * (`ReportSummaryJobResponse`). The RFC 9457 error contracts
 * `ProblemDetailsDto` / `SseProblemDetailsDto` intentionally keep the
 * `Dto` suffix: they are the stable cross-repo error contract and
 * `ProblemDetails` is already a domain name.
 */
export interface ResponseSchemaRegistration {
  /** OpenAPI path as exported (includes the `/api/v1` prefix), e.g. `/api/v1/public/app-info`. */
  path: string;
  /** HTTP method, lowercase. */
  method: string;
  /** Stable component name — keep the former DTO class name. */
  componentName: string;
  /** The zod schema describing the response body. */
  schema: z.ZodType;
  /** Optional 200 description. */
  description?: string;
}

export const responseSchemaRegistrations: ResponseSchemaRegistration[] = [];

export function registerResponseSchema(
  registration: ResponseSchemaRegistration,
): void {
  responseSchemaRegistrations.push(registration);
}
