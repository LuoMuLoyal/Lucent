import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';

import { successEnvelope } from '../../common/api-envelope';
import { type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  GenerateReportWeeklySummaryDto,
  ReportDashboardQueryDto,
  ReportDashboardResponseDto,
  ReportWeeklySummaryResponseDto,
} from './dto';
import { ReportsAiSummaryService } from './reports-ai-summary.service';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('user/reports')
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
  ) {
    return successEnvelope(
      await this.reportsService.getDashboard(user.sub, query),
    );
  }

  @Post('weekly-summary/generate')
  @ApiOperation({
    summary: 'Generate authenticated user weekly AI summary for report',
  })
  @ApiResponse({ status: 200, type: ReportWeeklySummaryResponseDto })
  async generateWeeklySummary(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateReportWeeklySummaryDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.reportsAiSummaryService.generate(user.sub, dto, language),
    );
  }
}
