import { Global, Module } from '@nestjs/common';
import { BullmqQueueFactory } from './queue.factory.js';

/**
 * Global module that provides the shared {@link BullmqQueueFactory}.
 *
 * Feature modules inject the factory to create Queue + Worker pairs without
 * duplicating Redis connection setup, error handling, or lifecycle management.
 */
@Global()
@Module({
  providers: [BullmqQueueFactory],
  exports: [BullmqQueueFactory],
})
export class BullmqModule {}
