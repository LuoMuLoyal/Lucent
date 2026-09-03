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
 * stable `componentName` (so Luminous client model names stay unchanged) and
 * (2) points the operation's 200 response at the component.
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
