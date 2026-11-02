/**
 * Public API of the `layouts` module.
 *
 * Only what another module could legitimately need: the surface vocabulary (a
 * client contract, useful for tests and for anything that generates a layout)
 * and the wire DTO types. The repository and the use cases stay private —
 * no other module has a reason to write a user's layout.
 */

export { LAYOUT_SURFACES, isLayoutSurface } from './domain/layout/surface.js';
export type { LayoutSurface } from './domain/layout/surface.js';
export {
  LAYOUT_SCHEMA_VERSION_MAX,
  LAYOUT_SCHEMA_VERSION_MIN,
} from './domain/layout/schema-version.js';
export type {
  LayoutListResponseDto,
  LayoutResponseDto,
} from './adapters/http/dto/response.js';
export type { SaveLayoutDto } from './adapters/http/dto/save-layout.js';
