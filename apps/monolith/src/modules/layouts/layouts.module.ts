import { Module } from '@nestjs/common';

import { LlmCommonModule } from '../../common/index.js';
import { LlmRuntimeModule } from '../../llm-runtime/llm-runtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { LayoutsController } from './adapters/http/layouts.controller.js';
import { GenerateSurface } from './application/use_cases/generate-surface.js';
import { SURFACE_GENERATOR } from './application/ports/surface-generator.js';
import { ReadLayouts } from './application/use_cases/read-layouts.js';
import { SaveLayout } from './application/use_cases/save-layout.js';
import { LayoutRepository } from './domain/layout/layouts.js';
import { LlmSurfaceGenerator } from './infrastructure/llm/surface-generator.js';
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
 *
 * ## Why the LLM modules are imported here
 *
 * The generative endpoint composes an A2UI document, which is a *layout
 * artefact* (same nature as the `payload` stored by `PUT /layouts/:surface`),
 * not a chat message. That is what keeps it in this module rather than in
 * `assistant`: the judgement is about what the endpoint produces, not about
 * whether it happens to call a model. `today-analysis` calls a model too and
 * remains its own module.
 */
@Module({
  imports: [AuthModule, LlmRuntimeModule, LlmCommonModule],
  controllers: [LayoutsController],
  providers: [
    PrismaLayouts,
    { provide: LayoutRepository, useExisting: PrismaLayouts },
    ReadLayouts,
    SaveLayout,
    GenerateSurface,
    LlmSurfaceGenerator,
    {
      provide: SURFACE_GENERATOR,
      useExisting: LlmSurfaceGenerator,
    },
  ],
})
export class LayoutsModule {}
