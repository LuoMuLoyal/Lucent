import {
  Body,
  Controller,
  HttpException,
  Post,
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
import { endSse, prepareSse, writeSseEvent } from '../../common/sse';
import { SkipApiEnvelope } from '../../common/interceptors/skip-api-envelope.decorator';
import { type UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TodayAnalysisService } from './services/today-analysis.service';
import {
  GenerateTodayAnalysisDto,
  TodayAnalysisResponseDto,
  TodayAnalysisStreamResultDto,
} from './dto';

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

  @Post('generate/stream')
  @SkipApiEnvelope()
  @ApiOperation({
    summary: 'Stream authenticated user today AI analysis generation',
  })
  @ApiResponse({ status: 200, type: TodayAnalysisStreamResultDto })
  async generateStream(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateTodayAnalysisDto,
    @I18nLang() language: string,
    @Res() response: Response,
  ): Promise<void> {
    prepareSse(response);

    try {
      const result = await this.todayAnalysisService.generateStream(
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
