import { z } from 'zod';

/**
 * Read-only status of the optional sidecar dependencies the assistant can use.
 *
 * The payload exposes enablement flags only — no base URLs, keys or internal
 * hostnames (`GET /admin/dependencies` renders an operations status page, not
 * a topology view).
 */
export const adminDependenciesResponseSchema = z
  .object({
    lightrag: z
      .object({
        enabled: z
          .boolean()
          .describe('Whether LIGHTRAG_ENABLED is on for this process.'),
      })
      .describe('LightRAG retrieval sidecar.'),
    semantica: z
      .object({
        enabled: z
          .boolean()
          .describe('Whether SEMANTICA_ENABLED is on for this process.'),
      })
      .describe('Semantica ontology sidecar.'),
    generatedAt: z
      .string()
      .describe('Response generation time (ISO 8601).'),
  })
  .meta({
    example: {
      lightrag: { enabled: true },
      semantica: { enabled: false },
      generatedAt: '2026-01-16T08:30:00.000Z',
    },
  });

export type AdminDependenciesResponseDto = z.infer<
  typeof adminDependenciesResponseSchema
>;
