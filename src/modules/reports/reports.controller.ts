import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { I18nLang } from 'nestjs-i18n';

import { successEnvelope } from '../../common/api';
import { httpExceptionPayload } from '../../common/helpers/error-payload';
import { SkipApiEnvelope } from '../../common/interceptors/skip-api-envelope.decorator';
import { endSse, prepareSse, writeSseEvent } from '../../common/api/sse';
import { type UserPayload } from '../auth/types/auth-request';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  GenerateReportSummaryDto,
  ReportDashboardQueryDto,
  ReportDashboardResponseDto,
  ReportSummaryResponseDto,
  ReportSummaryStreamResultDto,
  ClinicSummaryDto,
  ClinicSummaryShareResponseDto,
} from './dto';
import { ReportsAiSummaryService } from './services/ai-summary/summary.service';
import { ClinicSummaryService } from './services/clinic-summary/summary.service';
import { ReportsService } from './dashboard/dashboard.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsAiSummaryService: ReportsAiSummaryService,
    private readonly clinicSummaryService: ClinicSummaryService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get authenticated user report dashboard' })
  @ApiResponse({ status: 200, type: ReportDashboardResponseDto })
  async getDashboard(
    @CurrentUser() user: UserPayload,
    @Query() query: ReportDashboardQueryDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.reportsService.getDashboard(user.sub, query, language),
    );
  }

  @Post('summary/generate')
  @ApiOperation({
    summary: 'Generate authenticated user AI summary for report',
  })
  @ApiResponse({ status: 200, type: ReportSummaryResponseDto })
  async generateSummary(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.reportsAiSummaryService.generate(user.sub, dto, language),
    );
  }

  @Post('summary/generate/stream')
  @SkipApiEnvelope()
  @ApiOperation({
    summary: 'Stream authenticated user AI summary generation for report',
  })
  @ApiResponse({ status: 200, type: ReportSummaryStreamResultDto })
  async generateSummaryStream(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateReportSummaryDto,
    @I18nLang() language: string,
    @Res() response: Response,
  ): Promise<void> {
    prepareSse(response);

    try {
      const result = await this.reportsAiSummaryService.generateStream(
        user.sub,
        dto,
        language,
        ({ summary }) => {
          writeSseEvent(response, {
            event: 'summary',
            data: { summary },
          });
        },
      );

      writeSseEvent(response, {
        event: 'result',
        data: result,
      });
      writeSseEvent(response, {
        event: 'done',
        data: {},
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Report summary stream failed for user ${user.sub}: ${reason}`,
        error instanceof Error ? error.stack : undefined,
      );
      writeSseEvent(response, {
        event: 'error',
        data: httpExceptionPayload(error),
      });
    } finally {
      endSse(response);
    }
  }

  @Post('clinic-summary/preview')
  @ApiOperation({
    summary:
      'Generate a de-identified clinic summary for sharing with a doctor',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryDto })
  async previewClinicSummary(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.clinicSummaryService.buildClinicSummary(user.sub),
    );
  }

  @Post('clinic-summary/share')
  @ApiOperation({
    summary: 'Create a shareable link for the clinic summary (24h expiry)',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryShareResponseDto })
  async shareClinicSummary(@CurrentUser() user: UserPayload) {
    return successEnvelope(
      await this.clinicSummaryService.createShareLink(user.sub),
    );
  }

  @Public()
  @Get('clinic-summary/shared/:token')
  @ApiOperation({
    summary: 'Access a shared clinic summary by token (no auth required)',
  })
  @ApiResponse({ status: 200, type: ClinicSummaryDto })
  async getSharedClinicSummary(@Param('token') token: string) {
    const summary = await this.clinicSummaryService.getSharedSummary(token);
    if (!summary) {
      throw new HttpException(
        'Share link expired or invalid.',
        HttpStatus.GONE,
      );
    }
    return successEnvelope(summary);
  }

  @Get('clinic-summary/preview/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="clinic-summary.pdf"')
  @ApiOperation({
    summary: 'Download a de-identified clinic summary as PDF (auth required)',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF file',
    content: { 'application/pdf': {} },
  })
  async downloadClinicSummaryPdf(
    @CurrentUser() user: UserPayload,
    @I18nLang() language: string,
    @Res({ passthrough: false }) response: Response,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportPdf(user.sub, language);
    response.send(pdf);
  }

  @Public()
  @Get('clinic-summary/shared/:token/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="clinic-summary.pdf"')
  @ApiOperation({
    summary: 'Download a shared clinic summary as PDF (no auth required)',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF file',
    content: { 'application/pdf': {} },
  })
  async downloadSharedClinicSummaryPdf(
    @Param('token') token: string,
    @I18nLang() language: string,
    @Res({ passthrough: false }) response: Response,
  ): Promise<void> {
    const pdf = await this.clinicSummaryService.exportSharedPdf(
      token,
      language,
    );
    if (!pdf) {
      throw new HttpException(
        'Share link expired or invalid.',
        HttpStatus.GONE,
      );
    }
    response.send(pdf);
  }
}
