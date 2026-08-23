import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth';
import { ProblemDetailsDto } from '../../common';
import { unwrapResult } from '../../common/result';
import {
  LegalDocumentDetailResponseDto,
  LegalDocumentListResponseDto,
} from './dto/response.dto';

import { LegalDocumentQueryDto } from './dto/query.dto';
import { LegalDocumentsService } from './services/documents.service';

@ApiTags('Legal Documents')
@Public()
@Controller('legal-documents')
export class LegalDocumentsController {
  constructor(private readonly service: LegalDocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active legal documents' })
  @ApiResponse({ status: 200, type: LegalDocumentListResponseDto })
  async findAll(@Query() query: LegalDocumentQueryDto) {
    return await unwrapResult(this.service.findAll(query));
  }

  @Get(':docType')
  @ApiOperation({ summary: 'Get a specific legal document by type' })
  @ApiResponse({ status: 200, type: LegalDocumentDetailResponseDto })
  @ApiResponse({
    status: 404,
    type: ProblemDetailsDto,
    description: 'Document type not found or inactive.',
  })
  async findOne(
    @Param('docType') docType: string,
    @Query() query: LegalDocumentQueryDto,
  ) {
    return await unwrapResult(this.service.findOne(docType, query));
  }
}
