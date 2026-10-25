/**
 * The user-settings resource and update command, as the application layer
 * knows them.
 *
 * ## Why these types live in `application/ports/`
 *
 * `IUserSettingsPort` is consumed by `today-suggestion`, `reports` and
 * `assistant`, and it must be typed against the resource shape. If that shape
 * came from `adapters/http/dto/`, the application layer would depend on the
 * delivery layer (ADR-0024 D2) and the port could not describe itself
 * self-containedly.
 *
 * So the direction is inverted: the application layer **owns** the types, and
 * the HTTP adapter's zod schemas are pinned to them with
 * `satisfies z.ZodType<...>` in `adapters/http/dto/`. The wire contract and the
 * application type therefore cannot drift, and the dependency only points
 * inward.
 */

/** Fine-grained assistant context permission flags. */
export interface AssistantContextPermissionsResource {
  healthProfile: boolean;
  dailyRecords: boolean;
  sleepRecords: boolean;
  currentMedicines: boolean;
}

/**
 * Partial permission block accepted by an update (wire-side variant).
 *
 * Every key admits an explicit `undefined` for the same reason as
 * `UpdateUserSettingsCommand`.
 */
export interface AssistantContextPermissionsPatch {
  healthProfile?: boolean | undefined;
  dailyRecords?: boolean | undefined;
  sleepRecords?: boolean | undefined;
  currentMedicines?: boolean | undefined;
}

/** The authenticated user's settings resource (`GET`/`PATCH /user/settings`). */
export interface UserSettingsResource {
  aiSummariesEnabled: boolean;
  dataSharingConsent: boolean;
  assistantEnabled: boolean;
  assistantMemoryEnabled: boolean;
  waterTargetCount: number;
  assistantContext: AssistantContextPermissionsResource;
  /** ISO-8601 timestamp of the last write, or `null` when never written. */
  updatedAt: string | null;
  passwordReauthenticationRequired: boolean;
}

/**
 * Partial update command for `PATCH /user/settings`.
 *
 * ## Why every key admits `undefined` explicitly
 *
 * The web layer validates the body with a zod schema, and `z.infer` of an
 * optional key yields `T | undefined`. Under `exactOptionalPropertyTypes` that
 * is a *different* type from a bare optional `T`, so a `PATCH` body could not be
 * handed to a command typed `aiSummariesEnabled?: boolean`.
 *
 * Rather than let the application layer import the zod schema (which would point
 * the dependency outward and put a validation library in the application
 * layer's type surface), the command spells the `| undefined` out. "Key absent"
 * and "key explicitly undefined" both mean *leave untouched* in
 * `UserSettings.upsertsFor`, so the two are equivalent at runtime and the shapes
 * are mutually assignable. `user-settings-resource.spec.ts` asserts that.
 */
export interface UpdateUserSettingsCommand {
  aiSummariesEnabled?: boolean | undefined;
  dataSharingConsent?: boolean | undefined;
  assistantEnabled?: boolean | undefined;
  assistantMemoryEnabled?: boolean | undefined;
  waterTargetCount?: number | undefined;
  assistantContext?: AssistantContextPermissionsPatch | undefined;
}
