import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { successEnvelope } from '../../common/api';
import {
  LegalDocumentDetailResponseDto,
  LegalDocumentListResponseDto,
  LegalDocumentQueryDto,
} from './dto';
import { LegalDocumentsService } from './services';

@ApiTags('Legal Documents')
@Controller('legal-documents')
export class LegalDocumentsController {
  constructor(private readonly service: LegalDocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active legal documents' })
  @ApiResponse({ status: 200, type: LegalDocumentListResponseDto })
  async findAll(@Query() query: LegalDocumentQueryDto) {
    return successEnvelope(await this.service.findAll(query));
  }

  @Get(':docType')
  @ApiOperation({ summary: 'Get a specific legal document by type' })
  @ApiResponse({ status: 200, type: LegalDocumentDetailResponseDto })
  @ApiResponse({ status: 404, description: 'Document type not found' })
  async findOne(
    @Param('docType') docType: string,
    @Query() query: LegalDocumentQueryDto,
  ) {
    return successEnvelope(await this.service.findOne(docType, query));
  }
}
