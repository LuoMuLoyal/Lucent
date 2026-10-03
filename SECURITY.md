# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue.

Send a private report to **luomuloyal@outlook.com** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected version / commit

We aim to acknowledge reports within **48 hours** and deliver a fix or
mitigation within **7 days** for high-severity issues.

## Scope

The following are in scope:

- Authentication / authorization bypass
- SQL injection or other injection vulnerabilities
- Sensitive data exposure (PII, health records, tokens, secrets)
- SSRF, XSS, or other server-side injection
- Insecure deserialization
- Rate-limiting or abuse vectors on AI endpoints

The following are **out of scope**:

- Self-hosted misconfiguration (unless it stems from a code defect)
- Social engineering
- Physical attacks
- DoS without a demonstrated code-level vector

## Supported Versions

Only the latest release line receives security fixes. Pre-release versions
(`*-dev`) are not supported.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| `*-dev` | ❌        |

## Security Features

Lucent implements the following security measures:

- Argon2 password hashing
- JWT access + refresh token rotation with device-session records and remote session revocation
- In-app Security PIN with short-lived elevation tokens for sensitive operations
- `SecurityElevationGuard` on password change, email change, identity management,
  and data export endpoints
- AI safety policy forbidding diagnosis / prescription / dosage-adjustment output
- Server-owned assistant tool execution with bounded retrieval loops
- Coverage-aware abstention: conclusions carry `observedCount` / `expectedCount`, and
  missing data is returned as unknown rather than inferred as zero
- Field-level authorisation on clinic summaries (unselected fields never reach the preview,
  PDF export, or share outputs, which all read one filtered view)
- Revocable sharing: share links store only a token hash, expire, expose an access count,
  and can be revoked by the owner
- Provenance integrity: per-assertion provenance records are chained by digest, so any
  later deletion or edit breaks the chain and is detectable through the reasoning sidecar's
  `GET /provenance/verify`; records are also exportable as W3C PROV-O
- Explicit retrieval availability: an unavailable retrieval or reasoning service is reported
  as unavailable instead of degrading to an empty (and therefore misleading) result
- Audit logging for sensitive operations (sign-in, session revocation, proposal confirmation,
  data export) written through a fire-and-forget path, so a failed audit write is counted
  rather than failing the business request
- W3C Trace Context propagation (`traceparent` in, `traceresponse` out) alongside
  `X-Request-Id` propagation, so one user-visible failure maps to a single server-side call chain
- Environment-based secret management (no hardcoded credentials in code)

See [docs/reference/assistant-safety.md](docs/reference/assistant-safety.md) for the AI safety
boundary in full. Third-party components and their licences are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
