import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * GET /api/v1/health
   * Response will be wrapped by ApiEnvelopeInterceptor → { code: 0, message: "", data: ... }
   */
  getHealth(): Record<string, never> {
    return {};
  }
}
