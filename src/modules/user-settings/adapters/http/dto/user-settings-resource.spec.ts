/**
 * Pins the wire DTO types to the application-owned port types.
 *
 * ADR-0024 D2 forbids `application/**` from importing `adapters/**`, so the port
 * cannot borrow the zod-inferred DTOs. It declares its own
 * `UserSettingsResource` / `UpdateUserSettingsCommand` instead, and the DTOs are
 * pinned to those with `satisfies z.ZodType<UserSettingsResource>`.
 *
 * That `satisfies` covers the *response* direction only. For the update command
 * the two types are structural twins (the command spells out `| undefined` so a
 * zod-inferred body is assignable to it under `exactOptionalPropertyTypes`), and
 * nothing forces them to stay twins as fields are added. These two
 * type-level assertions do: if either side gains, loses or retypes a field, the
 * assignment below stops compiling.
 */

import type {
  UpdateUserSettingsCommand,
  UserSettingsResource,
} from '../../../application/ports/user-settings-resource.js';
import type {
  UpdateUserSettingsDto,
  UpdateAssistantContextSettingsDto,
} from './update.js';
import type { UserSettingsDataDto } from './response.js';
import type { AssistantContextPermissionsPatch } from '../../../application/ports/user-settings-resource.js';

describe('user-settings contract types', () => {
  it('keeps the response DTO and the application resource mutually assignable', () => {
    const fromDto: UserSettingsResource = {} as UserSettingsDataDto;
    const fromPort: UserSettingsDataDto = {} as UserSettingsResource;

    expect(fromDto).toBeDefined();
    expect(fromPort).toBeDefined();
  });

  it('keeps the update DTO and the application command mutually assignable', () => {
    const fromDto: UpdateUserSettingsCommand = {} as UpdateUserSettingsDto;
    const fromPort: UpdateUserSettingsDto = {} as UpdateUserSettingsCommand;

    expect(fromDto).toBeDefined();
    expect(fromPort).toBeDefined();
  });

  it('accepts a zod-inferred body whose optional keys carry `undefined`', () => {
    // This is the shape the controller really receives: `z.infer` of an optional
    // key is `T | undefined`, which must satisfy the command under
    // `exactOptionalPropertyTypes`.
    const body: UpdateUserSettingsCommand = {
      assistantEnabled: undefined,
      waterTargetCount: 12,
      assistantContext: { sleepRecords: undefined },
    } satisfies UpdateUserSettingsDto;

    const nested: AssistantContextPermissionsPatch = {
      healthProfile: undefined,
    } satisfies UpdateAssistantContextSettingsDto;

    expect(body.waterTargetCount).toBe(12);
    expect(nested.healthProfile).toBeUndefined();
  });
});
