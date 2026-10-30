import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { UserPayload } from '../../../auth/index.js';
import { CurrentUser } from '../../../auth/index.js';
import { registerResponseSchema } from '../../../../common/api/response-schema.registry.js';
import { ProblemDetailsDto } from '../../../../common/index.js';
import {
  createDomainFailure,
  DomainFailureException,
  unwrapResult,
} from '../../../../common/result/index.js';
import { ReadLayouts } from '../../application/use_cases/read-layouts.js';
import { SaveLayout } from '../../application/use_cases/save-layout.js';
import type { LayoutState } from '../../domain/layout/layout.js';
import { LAYOUT_SURFACES } from '../../domain/layout/surface.js';
import { isLayoutSurface } from '../../domain/layout/surface.js';
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
  constructor(
    private readonly readLayouts: ReadLayouts,
    private readonly saveLayout: SaveLayout,
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
