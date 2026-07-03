# Auth / Security PIN

Last updated: 2026-07-03

- The optional TOTP 2FA system has been replaced with an in-app 6-digit Security PIN.
- `User` carries `securityPinEnabled`, `securityPinHash`, `securityPinChangedAt`, and
  `securityElevationVersion` instead of the old `twoFactor*` columns.
- PIN management endpoints live under `/api/v1/settings/security-pin/*`: enable, verify, change,
  disable.
- A successful verify returns a short-lived signed elevation JWT (`scope: security_elevation`, 15
  minutes) carried in the `x-security-elevation` header.
- Elevation tokens are invalidated when the PIN is enabled, changed, or disabled because
  `securityElevationVersion` is bumped.
- Sensitive routes (`POST /account/password`, `POST /account/email`, `DELETE
 /account/identities/:identityId`, `POST /user/data-export-requests`, `GET
 /user/data-export-requests/latest`) are protected by `SecurityElevationGuard` and
  `@RequireSecurityElevation()`.
- Credential login no longer returns 2FA challenge fields (`requiresTwoFactor`, `tempToken`).
