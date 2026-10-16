import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HealthCheckResult } from '@nestjs/terminus';
import type { FastifyReply } from 'fastify';
import { Public } from './modules/auth/index.js';
import { registerResponseSchema } from './common/api/response-schema.registry.js';
import { healthCheckResultSchema } from './app.dto.js';
import { AppService } from './app.service.js';

const HEALTH_COMPONENT = 'HealthResponse';

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
  @ApiResponse({
    status: 200,
    description: 'Service is ready; all critical dependencies are up.',
  })
  @ApiResponse({
    status: 503,
    description: 'At least one critical dependency is unavailable.',
  })
  async getHealth(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.appService.getHealth();
    reply.status(this.replyStatusFor(result));
    return result;
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe for process health' })
  @ApiResponse({
    status: 200,
    description: 'Process is alive; downstream dependencies are not checked.',
  })
  getLiveHealth() {
    return this.appService.getLiveHealth();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe for critical runtime dependencies',
  })
  @ApiResponse({
    status: 200,
    description: 'All critical dependencies (database, cache) are up.',
  })
  @ApiResponse({
    status: 503,
    description: 'At least one critical dependency is unavailable.',
  })
  async getReadyHealth(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.appService.getReadyHealth();
    reply.status(this.replyStatusFor(result));
    return result;
  }

  @Get('deep')
  @ApiOperation({
    summary: 'Detailed health probe with per-component diagnostics',
  })
  @ApiResponse({
    status: 200,
    description: 'All probed dependencies are up, with detailed diagnostics.',
  })
  @ApiResponse({
    status: 503,
    description: 'At least one probed dependency is unavailable.',
  })
  async getDeepHealth(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.appService.getDeepHealth();
    reply.status(this.replyStatusFor(result));
    return result;
  }

  private replyStatusFor(result: HealthCheckResult): HttpStatus {
    return this.appService.isHealthy(result)
      ? HttpStatus.OK
      : HttpStatus.SERVICE_UNAVAILABLE;
  }
}

registerResponseSchema({
  path: '/api/v1/health',
  method: 'get',
  componentName: HEALTH_COMPONENT,
  schema: healthCheckResultSchema,
  description: 'Readiness probe alias: native terminus health-check result.',
  errorStatuses: [503],
});

registerResponseSchema({
  path: '/api/v1/health/live',
  method: 'get',
  componentName: HEALTH_COMPONENT,
  schema: healthCheckResultSchema,
  description: 'Liveness probe: native terminus health-check result.',
});

registerResponseSchema({
  path: '/api/v1/health/ready',
  method: 'get',
  componentName: HEALTH_COMPONENT,
  schema: healthCheckResultSchema,
  description:
    'Readiness probe for critical dependencies: native terminus health-check result.',
  errorStatuses: [503],
});

registerResponseSchema({
  path: '/api/v1/health/deep',
  method: 'get',
  componentName: HEALTH_COMPONENT,
  schema: healthCheckResultSchema,
  description:
    'Detailed probe with diagnostics: native terminus health-check result.',
  errorStatuses: [503],
});
