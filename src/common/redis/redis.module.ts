import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Global module that provides the shared {@link RedisService}.
 *
 * Services that need direct Redis atomic commands (INCR, EVAL, etc.)
 * inject `RedisService` instead of creating their own connections.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
