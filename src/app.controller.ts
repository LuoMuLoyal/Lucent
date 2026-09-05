import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from './modules/auth/index.js';
import { HealthResponse } from './app.dto.js';
import { AppService } from './app.service.js';

@ApiTags('Health')
@Public()
@Controller({
  path: 'health',
  version: '1',
})
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness probe alias used by existing scripts' })
  @ApiResponse({ status: 200, type: HealthResponse })
  @ApiResponse({ status: 503, type: HealthResponse })
  async getHealth(@Res({ passthrough: true }) reply: FastifyReply) {
    const probe = await this.appService.getHealth();
    reply.status(
      this.appService.isHealthy(probe)
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return probe;
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe for process health' })
  @ApiResponse({ status: 200, type: HealthResponse })
  getLiveHealth() {
    return this.appService.getLiveHealth();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe for critical runtime dependencies',
  })
  @ApiResponse({ status: 200, type: HealthResponse })
  @ApiResponse({ status: 503, type: HealthResponse })
  async getReadyHealth(@Res({ passthrough: true }) reply: FastifyReply) {
    const probe = await this.appService.getReadyHealth();
    reply.status(
      this.appService.isHealthy(probe)
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return probe;
  }

  @Get('deep')
  @ApiOperation({
    summary: 'Detailed health probe with per-component diagnostics',
  })
  @ApiResponse({ status: 200, type: HealthResponse })
  @ApiResponse({ status: 503, type: HealthResponse })
  async getDeepHealth(@Res({ passthrough: true }) reply: FastifyReply) {
    const probe = await this.appService.getDeepHealth();
    reply.status(
      this.appService.isHealthy(probe)
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return probe;
  }
}
