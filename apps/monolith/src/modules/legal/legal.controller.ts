import {
  Controller,
  Get,
  Param,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';

import { legalDocumentQuerySchema } from './dto/query.dto.js';
import type { LegalDocQueryDto } from './dto/query.dto.js';
import {
  legalDocumentDetailSchema,
  legalDocumentListSchema,
} from './dto/response.dto.js';
import { LegalService } from './services/documents.service.js';

@ApiTags('Legal Documents')
@Public()
@Controller('legal')
export class LegalController {
  constructor(private readonly service: LegalService) {}

  @Get()
  @ApiOperation({
    operationId: 'listLegalDocuments',
    summary: 'List all active legal documents',
  })
  @ApiResponse({
    status: 200,
    description: 'Active legal documents with list-level update timestamp.',
  })
  @SerializeOptions({ schema: legalDocumentListSchema })
  async findAll(
    @Query({ schema: legalDocumentQuerySchema }) query: LegalDocQueryDto,
  ) {
    return await unwrapResult(this.service.findAll(query));
  }

  @Get(':docType')
  @ApiOperation({
    operationId: 'getLegalDocument',
    summary: 'Get a specific legal document by type',
  })
  @ApiResponse({
    status: 200,
    description: 'Legal document detail with Markdown content.',
  })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsDto,
    description: 'Document type not found or inactive.',
  })
  @SerializeOptions({ schema: legalDocumentDetailSchema })
  async findOne(
    @Param('docType') docType: string,
    @Query({ schema: legalDocumentQuerySchema }) query: LegalDocQueryDto,
  ) {
    return await unwrapResult(this.service.findOne(docType, query));
  }
}

registerResponseSchema({
  path: '/api/v1/legal',
  method: 'get',
  componentName: 'LegalDocListResponse',
  schema: legalDocumentListSchema,
  description: 'Active legal documents with list-level update timestamp.',
});

registerResponseSchema({
  path: '/api/v1/legal/{docType}',
  method: 'get',
  componentName: 'LegalDocDetailResponse',
  schema: legalDocumentDetailSchema,
  description: 'Legal document detail with Markdown content.',
});
