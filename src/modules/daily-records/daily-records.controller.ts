import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common/api-envelope';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { UserPayload } from '../auth/auth.service';
import {
  CreateDailyRecordDto,
  UpdateDailyRecordDto,
  DailyRecordListResponseDto,
  DailyRecordSummaryResponseDto,
  DailyRecordResponseDto,
  CreateDailyRecordImageUploadDto,
  DailyRecordImageUploadResponseDto,
  DailyRecordCandidateResponseDto,
  GenerateDailyRecordCandidatesDto,
} from './dto';
import { DailyRecordCandidatesService } from './daily-record-candidates.service';
import { DailyRecordImageUploadService } from './daily-record-image-upload.service';
import { DailyRecordsService } from './daily-records.service';
import { I18nLang } from 'nestjs-i18n';

@ApiTags('Daily Records')
@Controller('user/daily-records')
export class DailyRecordsController {
  constructor(
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly dailyRecordCandidatesService: DailyRecordCandidatesService,
    private readonly imageUploadService: DailyRecordImageUploadService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List daily records for a given date' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-04' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, type: DailyRecordListResponseDto })
  async list(
    @CurrentUser() user: UserPayload,
    @Query('date') date: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = await this.dailyRecordsService.list(
      user.sub,
      date,
      kind,
      page != null ? parseInt(page, 10) : 1,
      pageSize != null ? parseInt(pageSize, 10) : 50,
    );
    return successEnvelope(result);
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get daily record summary (counts by kind)' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-04' })
  @ApiResponse({ status: 200, type: DailyRecordSummaryResponseDto })
  async summary(@CurrentUser() user: UserPayload, @Query('date') date: string) {
    const result = await this.dailyRecordsService.summary(user.sub, date);
    return successEnvelope(result);
  }

  @Post('attachments/images/presign-upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a Tencent COS signed URL for daily record image upload',
  })
  @ApiResponse({ status: 201, type: DailyRecordImageUploadResponseDto })
  createImageUpload(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDailyRecordImageUploadDto,
  ) {
    const result = this.imageUploadService.createPresignedUpload(user.sub, dto);
    return successEnvelope(result);
  }

  @Post('candidate-records/generate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Generate AI candidate daily records from a natural-language note',
  })
  @ApiResponse({ status: 200, type: DailyRecordCandidateResponseDto })
  async generateCandidates(
    @CurrentUser() _user: UserPayload,
    @Body() dto: GenerateDailyRecordCandidatesDto,
    @I18nLang() language: string,
  ) {
    const result = await this.dailyRecordCandidatesService.generate(
      dto,
      language,
    );
    return successEnvelope(result);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a daily record by id' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: DailyRecordResponseDto })
  async get(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    const result = await this.dailyRecordsService.get(user.sub, id);
    return successEnvelope(result);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a daily record' })
  @ApiResponse({ status: 201, type: DailyRecordResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDailyRecordDto,
  ) {
    const result = await this.dailyRecordsService.create(user.sub, dto);
    return successEnvelope(result);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a daily record' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: DailyRecordResponseDto })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDailyRecordDto,
  ) {
    const result = await this.dailyRecordsService.update(user.sub, id, dto);
    return successEnvelope(result);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Soft-delete a daily record' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200 })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.dailyRecordsService.delete(user.sub, id);
    return successEnvelope(null);
  }
}
