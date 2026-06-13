import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
import { TodayAnalysisService } from './analysis/today-analysis.service';
import { GenerateTodayAnalysisDto, TodayAnalysisResponseDto } from './dto';

@ApiTags('Today Analysis')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('user/today-analysis')
export class TodayAnalysisController {
  constructor(private readonly todayAnalysisService: TodayAnalysisService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate authenticated user today AI analysis' })
  @ApiResponse({ status: 200, type: TodayAnalysisResponseDto })
  async generate(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.todayAnalysisService.generate(user.sub, dto, language),
    );
  }
}
