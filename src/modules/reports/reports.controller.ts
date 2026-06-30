import {
  Body,
  Controller,
  Get,
  HttpException,
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

import { successEnvelope } from '../../common/api-envelope';
import { SkipApiEnvelope } from '../../common/interceptors/skip-api-envelope.decorator';
import { endSse, prepareSse, writeSseEvent } from '../../common/sse';
import { type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  GenerateReportSummaryDto,
  ReportDashboardQueryDto,
  ReportDashboardResponseDto,
  ReportSummaryResponseDto,
  ReportSummaryStreamResultDto,
} from './dto';
import { ReportsAiSummaryService } from './services/reports-ai-summary.service';
import { ReportsService } from './dashboard/reports.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsAiSummaryService: ReportsAiSummaryService,
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
      writeSseEvent(response, {
        event: 'error',
        data: httpExceptionPayload(error),
      });
    } finally {
      endSse(response);
    }
  }
}

function httpExceptionPayload(error: unknown): {
  message: string;
  code?: number;
  statusCode?: number;
} {
  if (!(error instanceof HttpException)) {
    return {
      message: error instanceof Error ? error.message : 'Unexpected error.',
    };
  }

  const response = error.getResponse();
  if (typeof response === 'string') {
    return withOptionalErrorFields(response, undefined, error.getStatus());
  }

  const message =
    'message' in response
      ? (response as { message?: unknown }).message
      : undefined;
  const code =
    'code' in response ? (response as { code?: unknown }).code : undefined;
  if (Array.isArray(message)) {
    return withOptionalErrorFields(
      message.join('; '),
      typeof code === 'number' ? code : undefined,
      error.getStatus(),
    );
  }
  if (typeof message === 'string' && message.trim().length > 0) {
    return withOptionalErrorFields(
      message,
      typeof code === 'number' ? code : undefined,
      error.getStatus(),
    );
  }
  return withOptionalErrorFields(
    error.message,
    typeof code === 'number' ? code : undefined,
    error.getStatus(),
  );
}

function withOptionalErrorFields(
  message: string,
  code?: number,
  statusCode?: number,
): { message: string; code?: number; statusCode?: number } {
  const payload: { message: string; code?: number; statusCode?: number } = {
    message,
  };
  if (code != null) {
    payload.code = code;
  }
  if (statusCode != null) {
    payload.statusCode = statusCode;
  }
  return payload;
}
