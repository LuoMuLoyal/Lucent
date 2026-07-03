# Security PIN Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lucent's optional 2FA path with a backend-enforced 6-digit in-app Security PIN system that protects selected sensitive operations through a 15-minute elevated-security window.

**Architecture:** Keep login/auth tokens unchanged. Add a separate Security PIN domain backed by `argon2` and user-row fields, plus a short-lived server-signed elevation token that is validated by a reusable guard on sensitive endpoints. Manage PIN lifecycle from the settings surface, and remove the current 2FA API/database contract entirely.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, existing JWT runtime, existing `argon2`, class-validator, OpenAPI export, Jest.

---

## File Structure

**Create**

- `prisma/migrations/<timestamp>_replace_two_factor_with_security_pin/migration.sql`
  Replaces 2FA columns with Security PIN and elevation-version columns.
- `src/modules/security-pin/security-pin.module.ts`
  Dedicated module for PIN lifecycle and elevation verification.
- `src/modules/security-pin/dto/security-pin.dto.ts`
  DTOs for enable / verify / change / disable requests plus response payloads.
- `src/modules/security-pin/services/security-pin.service.ts`
  Hashing, verification, elevation-token minting, version bumping, and state reads.
- `src/modules/security-pin/services/security-pin.service.spec.ts`
  Focused tests for PIN validation, hash verification, token TTL, and version invalidation.
- `src/modules/security-pin/guards/security-elevation.guard.ts`
  Reusable guard that enforces recent PIN verification on selected routes.
- `src/modules/security-pin/decorators/require-security-elevation.decorator.ts`
  Route metadata decorator for sensitive operations.
- `src/modules/security-pin/types/security-elevation.types.ts`
  Shared payload / metadata constants for the elevation token.

**Modify**

- `prisma/schema.prisma`
  Replace `twoFactor*` fields on `User` with `securityPin*` fields.
- `src/modules/auth/auth.controller.ts`
  Remove `2fa/*` endpoints and imports.
- `src/modules/auth/services/auth.service.ts`
  Remove 2FA delegation methods.
- `src/modules/auth/services/credential-auth.service.ts`
  Remove 2FA login branch and temp-token verification logic.
- `src/modules/auth/services/auth-two-factor.service.ts`
  Delete after all references are gone.
- `src/modules/auth/auth.module.ts`
  Remove `AuthTwoFactorService`; import `SecurityPinModule` only if auth still needs shared dependencies.
- `src/modules/account/account.controller.ts`
  Protect change-password, change-email, and unlink-identity routes with the elevation guard.
- `src/modules/account/account.controller.spec.ts`
  Extend tests for guard/decorator presence or updated controller wiring.
- `src/modules/data-export/data-export.controller.ts`
  Protect create-request and latest-request routes with the elevation guard.
- `src/modules/data-export/data-export.controller.spec.ts`
  Extend tests for protected routes.
- `src/modules/user-settings/user-settings.controller.ts`
  Add Security PIN management endpoints under settings.
- `src/modules/user-settings/user-settings.module.ts`
  Import `SecurityPinModule`.
- `src/modules/user-settings/dto/user-settings-response.dto.ts`
  Expose Security PIN state metadata.
- `src/modules/user-settings/services/user-settings.service.ts`
  Merge Security PIN state into settings reads.
- `src/modules/user-settings/user-settings.controller.spec.ts`
  Add endpoint tests for PIN lifecycle.
- `src/modules/auth/dto/index.ts`
  Remove 2FA DTO exports if present.
- `src/modules/auth/dto/two-factor.dto.ts`
  Delete after references are gone.
- `src/modules/account/services/account.service.ts`
  No core behavior change expected, but may need helper extraction if elevation context is passed deeper.
- `src/modules/data-export/services/data-export.service.ts`
  No business logic change expected; only if latest-download URL generation needs explicit comments or split methods.
- `src/modules/auth/services/credential-auth.service.spec.ts`
  Update login expectations after removing `requiresTwoFactor` / `tempToken`.
- `src/modules/auth/auth.service.spec.ts`
  Remove 2FA delegation expectations.
- `src/modules/auth/auth.controller.spec.ts`
  Remove 2FA route tests.
- `docs/Current_State.md`
  Record Security PIN boundary and protected actions.
- `docs/public/mine-settings-contract.md`
  Document Security PIN settings and elevated-action boundary.
- `docs/architecture.md`
  Add Security PIN guard / sensitive-route convention if route architecture changes materially.
- `docs/migration-log/2026-07-03.md`
  Append backend change summary.
- `docs/TODO.md`
  Delete the 2FA follow-up item after implementation is complete.
- `README.md`
  Update only if account-security capabilities are mentioned in setup/runtime docs.
- `docs/openapi.json`
  Regenerated artifact after controller/DTO changes.

## Task 1: Replace 2FA Schema With Security PIN Fields

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_replace_two_factor_with_security_pin/migration.sql`
- Test: `pnpm exec prisma validate`

- [ ] **Step 1: Write the failing schema expectation in a migration note / scratch diff**

```sql
-- users table should no longer keep:
-- two_factor_enabled
-- two_factor_secret
-- two_factor_recovery_codes
--
-- users table should add:
-- security_pin_enabled boolean not null default false
-- security_pin_hash text null
-- security_pin_changed_at timestamptz null
-- security_elevation_version integer not null default 0
```

- [ ] **Step 2: Update the Prisma model first**

```prisma
model User {
  id                       String   @id @default(uuid())
  email                    String?
  passwordHash             String?  @map("password_hash")
  nickname                 String?
  avatar                   String?
  status                   UserStatus @default(active)
  emailVerifiedAt          DateTime? @map("email_verified_at") @db.Timestamptz(3)
  lastLoginAt              DateTime? @map("last_login_at") @db.Timestamptz(3)
  securityPinEnabled       Boolean   @default(false) @map("security_pin_enabled")
  securityPinHash          String?   @map("security_pin_hash")
  securityPinChangedAt     DateTime? @map("security_pin_changed_at") @db.Timestamptz(3)
  securityElevationVersion Int       @default(0) @map("security_elevation_version")
  deletedAt                DateTime? @map("deleted_at") @db.Timestamptz(3)
  createdAt                DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt                DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
}
```

- [ ] **Step 3: Create the SQL migration with explicit data-loss intent**

```sql
ALTER TABLE "users"
  DROP COLUMN "two_factor_enabled",
  DROP COLUMN "two_factor_secret",
  DROP COLUMN "two_factor_recovery_codes",
  ADD COLUMN "security_pin_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "security_pin_hash" TEXT,
  ADD COLUMN "security_pin_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "security_elevation_version" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Run Prisma validation**

Run: `pnpm exec prisma validate`
Expected: PASS

- [ ] **Step 5: Regenerate Prisma client**

Run: `pnpm exec prisma generate`
Expected: PASS and generated client updates under `src/generated/prisma/`

## Task 2: Introduce Security PIN Domain And Elevation Token

**Files:**

- Create: `src/modules/security-pin/types/security-elevation.types.ts`
- Create: `src/modules/security-pin/services/security-pin.service.ts`
- Create: `src/modules/security-pin/services/security-pin.service.spec.ts`
- Create: `src/modules/security-pin/security-pin.module.ts`
- Test: `src/modules/security-pin/services/security-pin.service.spec.ts`

- [ ] **Step 1: Write the failing service tests for PIN lifecycle**

```ts
it('enables a 6-digit PIN with argon2 and bumps elevation version', async () => {
  await service.enable('user-1', { pin: '123456' });

  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        securityPinEnabled: true,
        securityPinHash: expect.any(String),
        securityElevationVersion: { increment: 1 },
      }),
    }),
  );
});

it('returns a 15-minute elevation token after successful verification', async () => {
  argon2Verify.mockResolvedValue(true);

  const result = await service.verify('user-1', { pin: '123456' });

  expect(result.expiresAt).toBeTruthy();
  expect(result.elevationToken).toEqual(expect.any(String));
});

it('rejects malformed pins before hash work', async () => {
  await expect(service.verify('user-1', { pin: '12a456' })).rejects.toThrow();
  expect(argon2Verify).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm test -- src/modules/security-pin/services/security-pin.service.spec.ts`
Expected: FAIL because module/service does not exist yet

- [ ] **Step 3: Implement minimal Security PIN service**

```ts
const SECURITY_PIN_REGEX = /^\d{6}$/;
const SECURITY_ELEVATION_TTL_SECONDS = 15 * 60;

async enable(userId: string, dto: { pin: string }) {
  this.assertPinFormat(dto.pin);
  const hash = await argon2.hash(dto.pin, ARGON2_OPTIONS);

  await this.prisma.user.update({
    where: { id: userId },
    data: {
      securityPinEnabled: true,
      securityPinHash: hash,
      securityPinChangedAt: new Date(),
      securityElevationVersion: { increment: 1 },
    },
  });
}

async verify(userId: string, dto: { pin: string }) {
  this.assertPinFormat(dto.pin);
  const user = await this.loadSecurityPinUser(userId);
  if (!user.securityPinEnabled || !user.securityPinHash) {
    forbidden(this.i18n.t('security_pin.not_enabled'));
  }

  const valid = await argon2.verify(user.securityPinHash, dto.pin);
  if (!valid) {
    unauthorized(this.i18n.t('security_pin.invalid_pin'));
  }

  return this.createElevation(user);
}
```

- [ ] **Step 4: Implement signed elevation token helpers in the same service**

```ts
private async createElevation(user: {
  id: string;
  securityElevationVersion: number;
}) {
  const expiresAt = new Date(Date.now() + SECURITY_ELEVATION_TTL_SECONDS * 1000);
  const elevationToken = await this.jwtService.signAsync(
    {
      sub: user.id,
      scope: 'security_elevation',
      version: user.securityElevationVersion,
    },
    {
      secret: this.jwtConfig.accessSecret,
      expiresIn: SECURITY_ELEVATION_TTL_SECONDS,
      algorithm: 'HS512',
      issuer: this.jwtConfig.issuer,
      audience: this.jwtConfig.audience,
    },
  );

  return { elevationToken, expiresAt: expiresAt.toISOString() };
}
```

- [ ] **Step 5: Re-run the focused service tests**

Run: `pnpm test -- src/modules/security-pin/services/security-pin.service.spec.ts`
Expected: PASS

## Task 3: Add Settings-Side PIN Management Endpoints

**Files:**

- Create: `src/modules/security-pin/dto/security-pin.dto.ts`
- Modify: `src/modules/user-settings/user-settings.controller.ts`
- Modify: `src/modules/user-settings/user-settings.module.ts`
- Modify: `src/modules/user-settings/dto/user-settings-response.dto.ts`
- Modify: `src/modules/user-settings/services/user-settings.service.ts`
- Test: `src/modules/user-settings/user-settings.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests for the PIN endpoints**

```ts
it('enables security pin from settings', async () => {
  securityPinService.enable.mockResolvedValue(undefined);

  const result = await controller.enableSecurityPin(mockUser, {
    pin: '123456',
  });

  expect(securityPinService.enable).toHaveBeenCalledWith('user-1', {
    pin: '123456',
  });
  expect(result.data).toBeNull();
});

it('verifies security pin and returns elevation token', async () => {
  securityPinService.verify.mockResolvedValue({
    elevationToken: 'token',
    expiresAt: '2026-07-03T12:15:00.000Z',
  });

  const result = await controller.verifySecurityPin(mockUser, {
    pin: '123456',
  });

  expect(result.data.elevationToken).toBe('token');
});
```

- [ ] **Step 2: Run the focused controller test**

Run: `pnpm test -- src/modules/user-settings/user-settings.controller.spec.ts`
Expected: FAIL because new endpoints and mocks do not exist yet

- [ ] **Step 3: Add DTOs and controller routes**

```ts
@Post('security-pin')
@HttpCode(HttpStatus.OK)
enableSecurityPin(
  @CurrentUser() user: UserPayload,
  @Body() dto: EnableSecurityPinDto,
) {
  return successEnvelope(this.securityPinService.enable(user.sub, dto));
}

@Post('security-pin/verify')
@HttpCode(HttpStatus.OK)
verifySecurityPin(
  @CurrentUser() user: UserPayload,
  @Body() dto: VerifySecurityPinDto,
) {
  return successEnvelope(this.securityPinService.verify(user.sub, dto));
}
```

- [ ] **Step 4: Extend settings response with PIN status only, never secrets**

```ts
export class SecurityPinSettingsDto {
  enabled!: boolean;
  lastChangedAt!: string | null;
}

export class UserSettingsDataDto {
  // existing fields...
  securityPin!: SecurityPinSettingsDto;
}
```

- [ ] **Step 5: Re-run the focused controller test**

Run: `pnpm test -- src/modules/user-settings/user-settings.controller.spec.ts`
Expected: PASS

## Task 4: Enforce Elevated Security On Sensitive Routes

**Files:**

- Create: `src/modules/security-pin/decorators/require-security-elevation.decorator.ts`
- Create: `src/modules/security-pin/guards/security-elevation.guard.ts`
- Modify: `src/modules/account/account.controller.ts`
- Modify: `src/modules/data-export/data-export.controller.ts`
- Test: `src/modules/account/account.controller.spec.ts`
- Test: `src/modules/data-export/data-export.controller.spec.ts`
- Test: `src/modules/security-pin/services/security-pin.service.spec.ts`

- [ ] **Step 1: Write failing guard tests**

```ts
it('accepts a valid elevation token with matching version and subject', async () => {
  jwtVerify.mockResolvedValue({
    sub: 'user-1',
    scope: 'security_elevation',
    version: 3,
  });
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    securityElevationVersion: 3,
    securityPinEnabled: true,
  });

  await expect(guard.canActivate(context)).resolves.toBe(true);
});

it('rejects when token version is stale after PIN change', async () => {
  jwtVerify.mockResolvedValue({
    sub: 'user-1',
    scope: 'security_elevation',
    version: 2,
  });
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    securityElevationVersion: 3,
    securityPinEnabled: true,
  });

  await expect(guard.canActivate(context)).rejects.toThrow();
});
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm test -- src/modules/security-pin/services/security-pin.service.spec.ts src/modules/account/account.controller.spec.ts src/modules/data-export/data-export.controller.spec.ts`
Expected: FAIL because guard/decorator wiring is missing

- [ ] **Step 3: Implement metadata decorator and guard**

```ts
export const REQUIRE_SECURITY_ELEVATION_KEY = 'requireSecurityElevation';
export const RequireSecurityElevation = () =>
  SetMetadata(REQUIRE_SECURITY_ELEVATION_KEY, true);

if (
  !this.reflector.getAllAndOverride(REQUIRE_SECURITY_ELEVATION_KEY, [
    context.getHandler(),
    context.getClass(),
  ])
) {
  return true;
}
```

```ts
const token = this.extractBearerTokenFromHeader(
  request.headers['x-security-elevation'],
);
const payload = await this.securityPinService.verifyElevationToken(
  token,
  user.sub,
);
request.securityElevation = payload;
return true;
```

- [ ] **Step 4: Mark sensitive endpoints**

```ts
@Post('password')
@RequireSecurityElevation()
async changePassword(...) {}

@Post('email')
@RequireSecurityElevation()
async changeEmail(...) {}

@Delete('identities/:identityId')
@RequireSecurityElevation()
async unlinkIdentity(...) {}

@Post()
@RequireSecurityElevation()
async createRequest(...) {}

@Get('latest')
@RequireSecurityElevation()
async getLatestRequest(...) {}
```

- [ ] **Step 5: Re-run focused tests**

Run: `pnpm test -- src/modules/security-pin/services/security-pin.service.spec.ts src/modules/account/account.controller.spec.ts src/modules/data-export/data-export.controller.spec.ts`
Expected: PASS

## Task 5: Remove 2FA Runtime And Replace Login Expectations

**Files:**

- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/services/auth.service.ts`
- Modify: `src/modules/auth/services/credential-auth.service.ts`
- Modify: `src/modules/auth/auth.module.ts`
- Delete: `src/modules/auth/services/auth-two-factor.service.ts`
- Delete: `src/modules/auth/dto/two-factor.dto.ts`
- Test: `src/modules/auth/auth.controller.spec.ts`
- Test: `src/modules/auth/services/auth.service.spec.ts`
- Test: `src/modules/auth/services/credential-auth.service.spec.ts`

- [ ] **Step 1: Write the failing auth test update**

```ts
it('returns normal token pair after successful password login without a 2FA branch', async () => {
  const result = await service.login(
    { email: 'user@example.com', password: 'Password123!' },
    context,
  );

  expect(result.accessToken).toBeDefined();
  expect((result as Record<string, unknown>).requiresTwoFactor).toBeUndefined();
  expect((result as Record<string, unknown>).tempToken).toBeUndefined();
});
```

- [ ] **Step 2: Run the auth-focused tests**

Run: `pnpm test -- src/modules/auth/auth.controller.spec.ts src/modules/auth/auth.service.spec.ts src/modules/auth/services/credential-auth.service.spec.ts`
Expected: FAIL because 2FA routes/branches still exist

- [ ] **Step 3: Remove controller routes and delegation methods**

```ts
// delete:
// POST auth/2fa/setup
// POST auth/2fa/confirm
// POST auth/2fa/verify
// DELETE auth/2fa
```

```ts
// remove from CredentialAuthService.login:
// if (updatedUser.twoFactorEnabled) { ... }
```

- [ ] **Step 4: Remove the obsolete service and module wiring**

```ts
providers: [
  VerificationCodeService,
  CredentialAuthService,
  // remove AuthTwoFactorService
];
```

- [ ] **Step 5: Re-run auth-focused tests**

Run: `pnpm test -- src/modules/auth/auth.controller.spec.ts src/modules/auth/auth.service.spec.ts src/modules/auth/services/credential-auth.service.spec.ts`
Expected: PASS

## Task 6: Regenerate Contract, Update Docs, And Run Final Verification

**Files:**

- Modify: `docs/Current_State.md`
- Modify: `docs/public/mine-settings-contract.md`
- Modify: `docs/architecture.md`
- Modify: `docs/TODO.md`
- Modify: `docs/migration-log/2026-07-03.md`
- Modify: `README.md` only if needed
- Modify: `docs/openapi.json` via generator

- [ ] **Step 1: Update the docs with the new boundary**

```md
- Security PIN is a separate 6-digit in-app credential hashed with argon2.
- Sensitive actions now require a PIN verification window valid for 15 minutes.
- Protected actions: report export creation, latest export download access, password change, email change, and OAuth identity unlink.
- Biometric unlock is not implemented in this phase.
```

- [ ] **Step 2: Remove the completed TODO item**

```md
- Add optional 2FA challenge verification before issuing tokens.
```

Expected: delete the line entirely from `docs/TODO.md`

- [ ] **Step 3: Export the new OpenAPI contract**

Run: `pnpm export:openapi`
Expected: PASS and `docs/openapi.json` reflects removed 2FA routes plus new settings PIN routes

- [ ] **Step 4: Run the backend verification set**

Run:

```bash
pnpm lint:check
pnpm typecheck
pnpm test -- src/modules/security-pin/services/security-pin.service.spec.ts src/modules/user-settings/user-settings.controller.spec.ts src/modules/account/account.controller.spec.ts src/modules/data-export/data-export.controller.spec.ts src/modules/auth/auth.controller.spec.ts src/modules/auth/auth.service.spec.ts src/modules/auth/services/credential-auth.service.spec.ts
pnpm build
```

Expected: all PASS

- [ ] **Step 5: Run the broader contract-sensitive check**

Run:

```bash
pnpm test:ci
```

Expected: PASS

## Notes

- Keep Security PIN separate from the login password. Do not silently fall back to “re-enter login password”.
- Do not expose any endpoint that returns the stored PIN hash or whether a submitted PIN was “almost correct”.
- The elevation token should be sent separately from the normal access token. Recommended header: `x-security-elevation: Bearer <token>`.
- Changing, enabling, or disabling the PIN must invalidate older elevation tokens by incrementing `securityElevationVersion`.
- This phase intentionally does not implement biometric unlock. Luminous can layer biometrics later on top of the same `verify PIN -> receive elevation token` boundary or a future device-bound unlock exchange.

## Self-Review

- Spec coverage: covers database replacement, settings lifecycle, protected routes, 2FA removal, docs, and OpenAPI regeneration.
- Placeholder scan: no `TODO`/`TBD` implementation steps remain inside the plan tasks.
- Type consistency: uses one naming family throughout: `securityPinEnabled`, `securityPinHash`, `securityPinChangedAt`, `securityElevationVersion`, `RequireSecurityElevation`, `x-security-elevation`.
