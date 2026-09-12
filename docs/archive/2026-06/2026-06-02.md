# Migration Log - 2026-06-02

## Auth Validation + Change Email Alignment

- ValidationPipe error codes mapped to contract (400002).
- ChangeEmail response now returns normalized persisted email.
- Logout constrained to current JWT user.

## I18n Dist Runtime Fix

- Type output restricted to development context to fix dist/test runtime failures.
