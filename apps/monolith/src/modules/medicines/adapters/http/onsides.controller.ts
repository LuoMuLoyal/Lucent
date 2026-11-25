import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { registerResponseSchema } from '../../../../common/api/response-schema.registry.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { Public } from '../../../auth/index.js';
import {
  ONSIDES_REACTIONS_READER,
  type OnsidesReactionsReader,
} from '../../application/ports/onsides.js';
import {
  ingredientReactionsResponseSchema,
  reactionDrugsQuerySchema,
  reactionDrugsResponseSchema,
  type ReactionDrugsQueryDto,
} from './dto/onsides.js';

/**
 * OnSIDES adverse-reaction endpoints.
 *
 * ## Why a separate controller
 *
 * OnSIDES is a **knowledge source of its own**, not a block inside the DrugBank
 * detail. It is keyed by RxNorm ingredient CUI + MedDRA term and carries no drug
 * record at all — no name, no indication, no interaction graph. Bolting it onto
 * `GET /medicines/:id` would have made that response's shape depend on whether a
 * RxCUI mapping happened to exist for the drug.
 *
 * ## Why the reverse direction exists
 *
 * "Which drugs could cause this reaction" is the question the prose leaflets could
 * never answer. It is the whole point of storing structured pairs, so it gets an
 * endpoint rather than an internal-only method.
 *
 * ## Why every endpoint is `@Public()`
 *
 * Same reason as the rest of `/medicines/*`: drug knowledge is read-only public
 * data and none of it is user-scoped.
 */
@ApiTags('Medicines')
@Controller('medicines')
export class OnsidesController {
  constructor(
    @Inject(ONSIDES_REACTIONS_READER)
    private readonly reader: OnsidesReactionsReader,
  ) {}

  @Public()
  @Get('ingredients/:rxnormCui/reactions')
  @ApiOperation({
    operationId: 'listIngredientReactions',
    summary: 'Label-stated adverse reactions for one RxNorm ingredient',
  })
  @ApiParam({
    name: 'rxnormCui',
    description: 'RxNorm ingredient CUI (e.g. 5640 for ibuprofen)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Adverse reactions stated by product labels for the ingredient, strongest evidence first.',
  })
  @ApiResponse({
    status: 404,
    description: 'No OnSIDES rows for this ingredient CUI.',
  })
  @SerializeOptions({ schema: ingredientReactionsResponseSchema })
  async ingredientReactions(@Param('rxnormCui') rxnormCui: string) {
    const view = await this.reader.getByIngredient(rxnormCui.trim());
    if (!view) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      );
    }
    return view;
  }

  @Public()
  @Get('drugs/:drugbankId/reactions')
  @ApiOperation({
    operationId: 'listDrugReactions',
    summary: 'Label-stated adverse reactions for one DrugBank drug',
  })
  @ApiParam({
    name: 'drugbankId',
    description: 'DrugBank drug id (e.g. DB01050)',
  })
  @ApiResponse({
    status: 200,
    description:
      "Adverse reactions resolved through the drug's RxCUI cross-reference.",
  })
  @ApiResponse({
    status: 404,
    description:
      'The drug has no RxCUI cross-reference to bridge through, or the ingredient has no statements. The bridge covers 8.2% of DrugBank rows at drug level (92.62% of OnSIDES pairs), so this is a normal outcome, not an error condition to retry.',
  })
  @SerializeOptions({ schema: ingredientReactionsResponseSchema })
  async drugReactions(@Param('drugbankId') drugbankId: string) {
    const view = await this.reader.getByDrugbankId(drugbankId.trim());
    if (!view) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      );
    }
    return view;
  }

  @Public()
  @Get('reactions/:meddraId/drugs')
  @ApiOperation({
    operationId: 'listReactionDrugs',
    summary: 'Drugs whose labels state a given MedDRA reaction',
  })
  @ApiParam({ name: 'meddraId', description: 'MedDRA term id (e.g. 10037844)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum drugs to return (1-200, default 50).',
  })
  @ApiResponse({
    status: 200,
    description: 'Drugs whose labels state the reaction, most-labelled first.',
  })
  @ApiResponse({ status: 404, description: 'Unknown MedDRA term id.' })
  @SerializeOptions({ schema: reactionDrugsResponseSchema })
  async reactionDrugs(
    @Param('meddraId') meddraId: string,
    @Query({ schema: reactionDrugsQuerySchema })
    query: ReactionDrugsQueryDto,
  ) {
    const view = await this.reader.getReactionDrugs(
      meddraId.trim(),
      query.limit,
    );
    if (!view) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      );
    }
    return view;
  }
}

registerResponseSchema({
  path: '/api/v1/medicines/ingredients/{rxnormCui}/reactions',
  method: 'get',
  componentName: 'IngredientReactionsResponse',
  schema: ingredientReactionsResponseSchema,
  description:
    'Adverse reactions stated by product labels for the ingredient, strongest evidence first.',
});
registerResponseSchema({
  path: '/api/v1/medicines/drugs/{drugbankId}/reactions',
  method: 'get',
  componentName: 'IngredientReactionsResponse',
  schema: ingredientReactionsResponseSchema,
  description:
    "Adverse reactions resolved through the drug's RxCUI cross-reference.",
});
registerResponseSchema({
  path: '/api/v1/medicines/reactions/{meddraId}/drugs',
  method: 'get',
  componentName: 'ReactionDrugsResponse',
  schema: reactionDrugsResponseSchema,
  description: 'Drugs whose labels state the reaction, most-labelled first.',
});
