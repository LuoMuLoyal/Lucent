import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { LayoutsController } from './adapters/http/layouts.controller.js';
import { ReadLayouts } from './application/use_cases/read-layouts.js';
import { SaveLayout } from './application/use_cases/save-layout.js';
import { LayoutRepository } from './domain/layout/layouts.js';
import { PrismaLayouts } from './infrastructure/persistence/layouts.js';

/**
 * User Profile context — interface layouts (ADR-0024).
 *
 * Wiring mirrors `user-settings`: `PrismaLayouts extends LayoutRepository`, and
 * the concrete class is aliased to the abstract token so the application layer
 * only ever sees the port.
 *
 * There is no cache layer. Layouts are read once per app start and written on
 * an explicit user action, so a cache would add an invalidation problem for no
 * latency win — unlike settings, which every request path reads.
 */
@Module({
  imports: [AuthModule],
  controllers: [LayoutsController],
  providers: [
    PrismaLayouts,
    { provide: LayoutRepository, useExisting: PrismaLayouts },
    ReadLayouts,
    SaveLayout,
  ],
})
export class LayoutsModule {}
