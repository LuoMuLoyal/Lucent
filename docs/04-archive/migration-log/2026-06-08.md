# Migration Log - 2026-06-08

## Docs Boundary Cleanup

- Removed the stale public product roadmap and public sub-index; product direction now lives in
  `../Luminous/docs/Product_Vision.md`.
- Reworked `docs/README.md` and `docs/01-reference/environment.md` so runtime config, deployment
  runbook, generated API contract, data-source strategy, and shared contracts have separate
  responsibilities.
- Updated environment snapshot and reminder contracts to match the Product_Vision MVP boundary.
