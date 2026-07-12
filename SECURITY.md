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
- JWT access + refresh token rotation
- In-app Security PIN with short-lived elevation tokens for sensitive operations
- `SecurityElevationGuard` on password change, email change, identity management,
  and data export endpoints
- AI safety policy forbidding diagnosis / prescription / dosage-adjustment output
- Server-owned assistant tool execution with bounded retrieval loops
- `X-Request-Id` propagation for audit traceability
- Environment-based secret management (no hardcoded credentials in code)
