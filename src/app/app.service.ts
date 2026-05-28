import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  ping(): { pong: true; timestamp: string } {
    return {
      pong: true,
      timestamp: new Date().toISOString(),
    };
  }
}
