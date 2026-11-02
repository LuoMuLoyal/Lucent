/**
 * Port for reading and updating user settings.
 *
 * Consumed by modules that need settings (`today-suggestion`, `reports`,
 * `assistant`) without depending on this module's use cases, read model or
 * cache internals — the point of the port is that its implementation can move
 * between layers without touching the consumers.
 *
 * Registered in `UserSettingsModule` via
 * `{ provide: IUserSettingsPort, useExisting: UserSettingsService }`.
 *
 * ## Signatures name application-owned types only
 *
 * `UserSettingsResource` / `UpdateUserSettingsCommand` live in
 * `user-settings-resource.ts` in this directory, not in `adapters/http/dto/`.
 * A port that borrowed the HTTP DTOs would invert the layer direction (D2) and
 * could not describe itself without the delivery layer; the DTO schemas are
 * instead pinned to these types with `satisfies z.ZodType<...>`.
 */

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { UserSettingsResource } from './user-settings-resource.js';
import type { UpdateUserSettingsCommand } from './user-settings-resource.js';

export abstract class IUserSettingsPort {
  /** Reads the whole resource; defaults fill any row the user never wrote. */
  abstract getSettings(userId: string): Promise<UserSettingsResource>;

  /**
   * Applies a partial update and returns the re-read resource.
   *
   * Typed against the zod-inferred body on purpose. The web layer parses the
   * request with `updateUserSettingsSchema`, and `z.infer` of an optional key is
   * `boolean | undefined`, which `exactOptionalPropertyTypes` distinguishes from
   * a bare optional `boolean`. Accepting the DTO here keeps consumers working
   * without touching them; the spec `user-settings-resource.spec.ts` asserts the
   * DTO and `UpdateUserSettingsCommand` stay assignable, so the two cannot
   * drift, and the edge is `type`-only (no runtime import of `adapters/`).
   */
  abstract updateSettings(
    userId: string,
    dto: UpdateUserSettingsCommand,
  ): ResultAsync<UserSettingsResource, DomainFailure>;
}
