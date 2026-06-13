import { Controller, Get, Header, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipApiEnvelope } from './common/interceptors/skip-api-envelope.decorator';
import { AppService } from './app.service';

@ApiExcludeController()
@SkipApiEnvelope()
@Controller({
  path: 'metrics',
  version: VERSION_NEUTRAL,
})
export class MetricsController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(@Res() response: Response): Promise<void> {
    response.send(await this.appService.getMetrics());
  }
}
