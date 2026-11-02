import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { I18nLang } from 'nestjs-i18n';

import type { UserPayload } from '../../../auth/index.js';
import { CurrentUser } from '../../../auth/index.js';
import { registerResponseSchema } from '../../../../common/api/response-schema.registry.js';
import {
  endSse,
  extractErrorInfo,
  prepareSse,
  ProblemDetailsDto,
  SseConnectionRegistry,
  SseProblemDetailsMapper,
  writeSseEvent,
} from '../../../../common/index.js';
import {
  createDomainFailure,
  DomainFailureException,
  unwrapResult,
} from '../../../../common/result/index.js';
import { GenerateSurface } from '../../application/use_cases/generate-surface.js';
import { ReadLayouts } from '../../application/use_cases/read-layouts.js';
import { SaveLayout } from '../../application/use_cases/save-layout.js';
import type { LayoutState } from '../../domain/layout/layout.js';
import { LAYOUT_SURFACES } from '../../domain/layout/surface.js';
import { isLayoutSurface } from '../../domain/layout/surface.js';
import {
  GENERATIVE_SURFACES,
  validateGenerationRequest,
} from '../../domain/generative/generation-request.js';
import { generateSurfaceSchema } from './dto/generate-surface.js';
import type { GenerateSurfaceDto } from './dto/generate-surface.js';
import {
  layoutListResponseSchema,
  layoutResponseSchema,
} from './dto/response.js';
import { saveLayoutSchema } from './dto/save-layout.js';
import type { SaveLayoutDto } from './dto/save-layout.js';

/**
 * Interface layout storage.
 *
 * The server is a **dumb store with a version guard**: it persists the client's
 * layout document verbatim and enforces `schemaVersion` range plus `version`
 * monotonicity. Everything semantic — which components exist, their order,
 * their sizes — is decided by the client. That is what keeps layout changes a
 * client-only release.
 */
@ApiTags('Layouts')
@ApiBearerAuth('access-token')
@Controller('layouts')
export class LayoutsController {
  private readonly logger = new Logger(LayoutsController.name);

  constructor(
    private readonly readLayouts: ReadLayouts,
    private readonly saveLayout: SaveLayout,
    private readonly generateSurface: GenerateSurface,
    private readonly sseRegistry: SseConnectionRegistry,
    private readonly sseProblemDetails: SseProblemDetailsMapper,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listLayouts',
    summary: 'List all stored layouts of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Stored layouts keyed by surface.',
  })
  @SerializeOptions({ schema: layoutListResponseSchema })
  async listLayouts(@CurrentUser() user: UserPayload) {
    const layouts = await this.readLayouts.list(user.sub);
    // Convert every entry here, not only the single-get path: the serializer
    // parses the return value through the schema, so a raw `Date` in any entry
    // would fail the whole response.
    return {
      surfaces: Object.fromEntries(
        Object.entries(layouts).map(([surface, layout]) => [
          surface,
          toWire(layout),
        ]),
      ),
    };
  }

  @Get(':surface')
  @ApiOperation({
    operationId: 'getLayout',
    summary: 'Get one surface layout of the authenticated user',
  })
  @ApiParam({
    name: 'surface',
    enum: LAYOUT_SURFACES,
    description: 'Surface identifier.',
  })
  @ApiResponse({
    status: 200,
    description: 'The stored layout for this surface.',
  })
  @ApiResponse({
    status: 404,
    description: 'No layout stored for this surface (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: layoutResponseSchema })
  async getLayout(
    @CurrentUser() user: UserPayload,
    @Param('surface') surface: string,
  ) {
    // Unknown surface is a 400, not a 404: the caller named something this
    // backend does not have, which is a contract mismatch rather than an empty
    // collection. Checking it here keeps the read path free of the cast.
    if (!isLayoutSurface(surface)) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'validation',
          code: 'LAYOUT_SURFACE_UNKNOWN',
          args: { surface },
        }),
      );
    }
    // `toWire` also converts `updatedAt` to an ISO string — the serializer
    // parses this return value through `layoutResponseSchema`, which rejects a
    // raw `Date`.
    return toWire(await unwrapResult(this.readLayouts.get(user.sub, surface)));
  }

  @SkipThrottle()
  @RouteConfig({ compress: false })
  @Post(':surface/generate')
  @ApiOperation({
    operationId: 'generateLayoutSurface',
    summary: 'Stream an AI-composed A2UI surface for this screen',
  })
  @ApiParam({
    name: 'surface',
    enum: GENERATIVE_SURFACES,
    description: 'Surface to compose. The tab bar is not composable.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Server-Sent Events stream without the API envelope. Each event has an "event" ' +
      'field (chunk | result | error | done) and a JSON "data" field.',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string',
          description:
            'Each frame is UTF-8 SSE text. event=chunk data=A2uiMessage; ' +
            'event=result data=SurfaceStreamResult; ' +
            'event=error data=ProblemDetails; event=done data={}.',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Empty prompt or a surface that cannot be composed (GENERATIVE_PROMPT_EMPTY / GENERATIVE_SURFACE_UNSUPPORTED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Prompt exceeds the length bound (GENERATIVE_PROMPT_TOO_LONG)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 502,
    description:
      'Model output rejected by the catalog (GENERATIVE_OUTPUT_REJECTED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 503,
    description: 'No model configured (LLM_NOT_CONFIGURED)',
    type: ProblemDetailsDto,
  })
  async generate(
    @CurrentUser() user: UserPayload,
    @Param('surface') surface: string,
    @Body({ schema: generateSurfaceSchema }) dto: GenerateSurfaceDto,
    @I18nLang() language: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Validate BEFORE the stream starts. `prepareSse` fixes the HTTP status at
    // 200, so anything rejected after it can only surface as an in-stream
    // `event: error` — making a malformed request look successful to any client
    // that only inspects the status line. Cheap, pure checks belong outside the
    // stream; only generation-time failures belong inside it.
    const shapeFailure = validateGenerationRequest({
      surface,
      prompt: dto.prompt,
      ...(dto.range == null ? {} : { range: dto.range }),
    });
    if (shapeFailure != null) {
      throw new DomainFailureException(shapeFailure);
    }

    // Language decides the copy of BOTH the errors and the generated strings:
    // it is forwarded to the generator through the use case, and to the error
    // mapper below. Dropping it here would show English errors to a zh-CN user.
    prepareSse(reply.raw, this.sseRegistry, language, reply.getHeaders());

    try {
      let streamed = 0;
      const result = await this.generateSurface.execute(
        {
          surface,
          prompt: dto.prompt,
          ...(dto.range == null ? {} : { range: dto.range }),
          language,
        },
        (message) => {
          streamed += 1;
          writeSseEvent(reply.raw, { event: 'chunk', data: message });
        },
      );

      writeSseEvent(reply.raw, {
        event: 'result',
        data: {
          surface: result.surface,
          messages: result.messages,
          usage: result.usage,
        },
      });
      this.logger.log(
        {
          userId: user.sub,
          surface: result.surface,
          messages: result.messages.length,
          streamed,
        },
        'Generative surface composed',
      );
      writeSseEvent(reply.raw, { event: 'done', data: {} });
    } catch (error) {
      const { message: reason, stack } = extractErrorInfo(error);
      this.logger.error(
        { stack },
        `Surface generation failed for user ${user.sub}: ${reason}`,
      );
      writeSseEvent(reply.raw, {
        event: 'error',
        data: this.sseProblemDetails.build(error, { lang: language }),
      });
    } finally {
      endSse(reply.raw, this.sseRegistry);
    }
  }
  @Put(':surface')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'saveLayout',
    summary: 'Create or replace one surface layout',
  })
  @ApiParam({
    name: 'surface',
    enum: LAYOUT_SURFACES,
    description: 'Surface identifier.',
  })
  @ApiResponse({
    status: 200,
    description: 'The stored layout after the write.',
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown surface or invalid body (LAYOUT_SURFACE_UNKNOWN)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Version conflict (LAYOUT_VERSION_CONFLICT); carries the current document under `errors.current`',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 422,
    description:
      'Unsupported document shape (LAYOUT_SCHEMA_VERSION_UNSUPPORTED)',
    type: ProblemDetailsDto,
  })
  @SerializeOptions({ schema: layoutResponseSchema })
  async saveOne(
    @CurrentUser() user: UserPayload,
    @Param('surface') surface: string,
    @Body({ schema: saveLayoutSchema }) dto: SaveLayoutDto,
  ) {
    const outcome = await unwrapResult(
      this.saveLayout.execute({
        userId: user.sub,
        surface,
        ifVersion: dto.ifVersion,
        schemaVersion: dto.schemaVersion,
        payload: dto.payload,
      }),
    );

    if ('conflict' in outcome) {
      // 409 carries the winning document so the client can adopt it without a
      // second round trip. It rides in `errors` because the Problem Details
      // envelope only forwards whitelisted fields — arbitrary top-level keys
      // would be dropped by the exception filter.
      throw new ConflictException({
        code: 'LAYOUT_VERSION_CONFLICT',
        errors: {
          current: outcome.conflict == null ? null : toWire(outcome.conflict),
        },
      });
    }

    return toWire(outcome.saved);
  }
}

/** Domain state → wire shape. One place, so the DTO cannot drift. */
function toWire(layout: LayoutState) {
  return {
    surface: layout.surface,
    version: layout.version,
    schemaVersion: layout.schemaVersion,
    payload: layout.payload,
    updatedAt: layout.updatedAt.toISOString(),
  };
}

registerResponseSchema({
  path: '/api/v1/layouts',
  method: 'get',
  componentName: 'LayoutListResponse',
  schema: layoutListResponseSchema,
  description: 'Stored layouts keyed by surface.',
});

registerResponseSchema({
  path: '/api/v1/layouts/{surface}',
  method: 'get',
  componentName: 'LayoutResponse',
  schema: layoutResponseSchema,
  description: 'The stored layout for this surface.',
});

registerResponseSchema({
  path: '/api/v1/layouts/{surface}',
  method: 'put',
  componentName: 'LayoutResponse',
  schema: layoutResponseSchema,
  description: 'The stored layout after the write.',
});
