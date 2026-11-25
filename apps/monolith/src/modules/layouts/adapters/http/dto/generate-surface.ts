import { z } from 'zod';

/**
 * Standard Schema for `POST /layouts/:surface/generate` and
 * `POST /layouts/:surface/turn`.
 *
 * `prompt` bounds are declared here as well as in the domain: this layer gives
 * the client a fast, field-targeted 400 before the request reaches the use
 * case, while the domain rule remains the authority (it also runs for calls that
 * bypass HTTP, e.g. tests). The two use the same constant so they cannot drift
 * apart.
 */

/**
 * The client's catalog document.
 *
 * Loose on purpose: the client owns the vocabulary, so the server cannot model
 * it. The only bound is size, enforced in the domain — a schema here would
 * become the second copy A2UI 1.0 set out to delete.
 */
export const surfaceCapabilitiesSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'The renderer capabilities document the client advertised (A2UI v1.0). ' +
      'Its inline catalogs define the component vocabulary the model may use.',
  );

export const generateSurfaceSchema = z
  .object({
    prompt: z
      .string()
      .describe(
        "Natural-language instruction describing what to show, in the user's own words.",
      )
      .meta({
        example: '把每日饮水做成三张并排的小卡，再配一句这周的整体情况',
      }),
    range: z
      .enum(['7d', '30d'])
      .optional()
      .describe('Preferred time range; the model may ignore it.')
      .meta({ example: '7d' }),
    capabilities: surfaceCapabilitiesSchema.optional(),
  })
  .describe('Instruction for one generative surface.');

export type GenerateSurfaceDto = z.infer<typeof generateSurfaceSchema>;

/**
 * One A2UI v1.0 message.
 *
 * Kept as a loose record on purpose: the message shape is owned by the A2UI
 * spec and enforced by the client's renderer plus the server's envelope check,
 * not by this transport schema.
 */
export const a2uiMessageSchema = z
  .record(z.string(), z.unknown())
  .describe('One A2UI v1.0 message object.')
  .meta({
    example: {
      version: '1.0',
      updateComponents: {
        surfaceId: 'generative.review',
        components: [
          { id: 'root', component: 'Column', children: ['title', 'water'] },
          { id: 'title', component: 'Text', text: '本周概览' },
          { id: 'water', component: 'metric_card', kind: 'water', range: '7d' },
        ],
      },
    },
  });

/** The surface document as the client holds it. */
export const surfaceDocumentSchema = z
  .object({
    messages: z
      .array(a2uiMessageSchema)
      .describe('Agent-to-renderer messages, in arrival order.'),
    dataModel: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Data model snapshot, present when a surface was created with sendDataModel.',
      ),
  })
  .describe('The A2UI document the interaction happened on.');

export type SurfaceDocumentDto = z.infer<typeof surfaceDocumentSchema>;

/**
 * Standard Schema for `POST /layouts/:surface/turn`.
 *
 * Carries the renderer's outbound messages and the document they act on: the
 * server is stateless, so a round must be self-contained.
 */
export const surfaceTurnSchema = z
  .object({
    messages: z
      .array(a2uiMessageSchema)
      // No `.min(1)`: an empty round is a *domain* rejection
      // (`GENERATIVE_TURN_EMPTY`, 422), and a schema bound here would turn it
      // into a generic `VALIDATION_FAILED` 400 before the domain ever saw it.
      .describe(
        'Renderer-to-agent messages (action / callAgentFunction / ' +
          'rendererFunctionResponse / error) that the user interaction produced.',
      )
      .meta({
        example: [
          {
            version: '1.0',
            action: {
              name: 'confirm_dose',
              surfaceId: 'generative.medicine',
              context: { dose: 2 },
            },
          },
        ],
      }),
    document: surfaceDocumentSchema,
    capabilities: surfaceCapabilitiesSchema.optional(),
  })
  .describe('One interaction round for a generated surface.');

export type SurfaceTurnDto = z.infer<typeof surfaceTurnSchema>;

/** Token accounting for one generation. */
export const surfaceStreamUsageSchema = z
  .object({
    promptTokens: z
      .number()
      .int()
      .min(0)
      .describe('Tokens consumed by the instruction and catalog description.')
      .meta({ example: 1240 }),
    completionTokens: z
      .number()
      .int()
      .min(0)
      .describe('Tokens produced by the model.')
      .meta({ example: 486 }),
  })
  .describe('Token usage for one generation.');

/**
 * Payload of the `event: result` frame.
 *
 * Carries **no server-authored copy**: every user-visible string inside
 * `messages` is either written by the model in the client's language or passed
 * through verbatim from the backend (`finding`). The client decides all
 * surrounding chrome from its own ARB.
 */
export const surfaceStreamResultSchema = z
  .object({
    surface: z
      .string()
      .describe('Surface this document was composed for.')
      .meta({ example: 'review' }),
    messages: z
      .array(a2uiMessageSchema)
      .describe(
        'A2UI messages in arrival order; replay them to rebuild the tree.',
      )
      .meta({
        example: [
          {
            version: '1.0',
            createSurface: {
              surfaceId: 'generative.review',
              catalogId: 'https://luminous.app/a2ui/catalog/v1.json',
              sendDataModel: true,
            },
          },
        ],
      }),
    dataModel: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Data model snapshot the client should keep alongside.'),
    usage: surfaceStreamUsageSchema,
  })
  .describe('The completed generation.');

export type SurfaceStreamResultDto = z.infer<typeof surfaceStreamResultSchema>;

/** Payload of the `event: error` frame. Mirrors Problem Details fields. */
export const surfaceStreamErrorSchema = z
  .object({
    code: z
      .string()
      .describe('Stable problem code; see the problem catalogue.')
      .meta({ example: 'GENERATIVE_OUTPUT_REJECTED' }),
    title: z
      .string()
      .describe("Localized short title, in the client's language.")
      .meta({ example: 'The generated layout was rejected' }),
    detail: z
      .string()
      .describe("Localized explanation, in the client's language.")
      .meta({ example: 'The result did not pass the safety check.' }),
  })
  .describe('Failure reported on the stream.');

export type SurfaceStreamErrorDto = z.infer<typeof surfaceStreamErrorSchema>;
