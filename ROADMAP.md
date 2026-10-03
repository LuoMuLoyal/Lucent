# Lucent Roadmap

This document describes the planned evolution of the Lucent backend. It is a living document, and
directions shift as the product and its operational reality change.

The task-level ledger of deferred work is [docs/TODO.md](docs/TODO.md), and active multi-step work
lives in [`plans/`](plans/). This file carries the direction those two serve; it does not repeat
their items.

## Status

Lucent is at `0.1.0-dev`. Every feature area described in [README.md](README.md) exists and is
exercised by unit and end-to-end tests, and the backend is deployed and serving a live public
environment. No stable release has been cut, and the HTTP contract should not yet be treated as
frozen.

The current shape of the system:

- **Contract-first.** Controller and DTO code plus the generated `openapi.json` are the single API
  contract. Hand-written endpoint docs are not maintained.
- **Coverage-aware by construction.** Missing data is returned as unknown, never inferred as zero.
  Every conclusion carries `observedCount` / `expectedCount`, and thin evidence produces abstention
  instead of a weaker claim. This discipline is enforced in the data model, the response contract
  and the UI.
- **AI has no conclusion authority on safety.** Rules, leaflets and curated data decide; the model
  explains. Diagnosis, prescription and dosage adjustment are structurally out of scope for model
  output.
- **Two graphs, not one.** Chinese unstructured knowledge is graph-extracted from prose; English
  structured DrugBank facts are mapped in deterministically with no model extraction. They are
  deliberately not merged, so any conclusion traces back to exactly one source.
- **Sources are reported honestly.** An unavailable retrieval or reasoning service reports
  unavailable. An empty graph result means this source does not assert it, not that it is false.
- **Operated on three hosts.** One application host, one graph host, one monitoring host; images
  built natively per architecture, migrations applied by the container entrypoint.

## Directions

### Current release → `0.1.0`

Close the deferred items that block a first stable tag. The concrete list is
[docs/TODO.md](docs/TODO.md); the recurring themes are:

- Evaluation and production verification for the retrieval layers (Chinese prose graph mode, the
  QA corpus workspace, and sidecar reachability under real credentials).
- Removing transitional seams once their consumers migrate, for example the health-events
  ownership shim that still folds a module's result type back into a promise for legacy consumers.
- Closing the storage lifecycle gap on uploaded objects (no deletion or retention path today).

### `1.0.0` — Production readiness

The first release milestone. Most of the work is making current behaviour dependable and auditable
rather than adding features:

- **Backups and restore drills.** Automated database backups are not configured today. A release
  cannot be called production-ready while recovery is unproven.
- **Contract stability.** Freeze the v1 contract, document the deprecation policy for stable error
  codes, and keep the committed spec a hard CI gate.
- **Observability closure.** Alerting is already provisioned as versioned Grafana YAML; the
  remaining work is proving the alerts fire on real failure modes instead of only on paper.
- **Security review against the reporting scope** in [SECURITY.md](SECURITY.md).

### `1.x` — Depth in the knowledge and reasoning layers

- **Scale the medicine knowledge base** and finish the retrieval evaluation, so graph mode is
  switched on the basis of measurement instead of configuration.
- **Widen versioned rule coverage** for ontology reasoning, keeping the guarantee that callers never
  submit a query directly and that derived conclusions stay clearly separated from citable ones.
- **Provenance as an external interface**: keep PROV-O export consumption-ready for tools outside
  this product, instead of something only Lucent can verify about itself.

### Beyond `1.x` — Platform research

Explicitly exploratory, not committed:

- Alternative graph backends and database engines, subject to the migration boundary recorded in
  the README (the vector and text-search extensions have no drop-in equivalent on commercial
  engines today).
- Self-hosted model runtimes, to reduce dependence on a single model platform.
- Multi-region deployment, if the operational cost can be justified.

## Versioning

Releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the major version
is zero, the HTTP contract may change between minor versions; each such change is exported to
`openapi.json`, recorded in the migration log, and propagated to the Flutter client.

| Version     | Status         | Notes                                                             |
| ----------- | -------------- | ----------------------------------------------------------------- |
| `0.1.0-dev` | In development | Current state                                                     |
| `1.0.0`     | Planned        | First release milestone: backups, contract freeze, alerting proof |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, commit and PR conventions, and
[AGENTS.md](AGENTS.md) for module, documentation and architecture rules.

## Feedback

This roadmap is open to discussion. Open an issue to propose changes, suggest priorities, or flag
missing items.
