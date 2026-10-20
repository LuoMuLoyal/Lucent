---
status: active
owner: backend
quadrant: explanation
updated: 2026-10-20
---

# Runtime config lifecycle

Why a value can change without a deploy, and what happens when the configuration
center is wrong. Field-level reference lives in
[environment-variables](../reference/environment-variables.md#rnacos--运行时配置中心可选);
the operator document template is `docs/reference/runtime-config.example.txt`.

## Shape of the system

Environment variables are the baseline, not a peer of the configuration center.
At startup the process builds a complete snapshot from env (with per-environment
defaults resolved in code), and only then — if `RNACOS_ENABLED=true` — asks
rnacos for a document. The center is a layer of _overrides_ on top of a state
that already works.

The snapshot is an immutable value object. Consumers read
`getSnapshot().values` every time they need a value; they never keep a field
from construction time. That single rule is what makes a publish visible without
a restart, and it is also why the hot path never performs I/O: a snapshot read
is a property access on an in-memory reference.

## Load → validate → publish

1. **Load.** The source adapter reads one `dataId` once at bootstrap, then
   subscribes to pushes. When the center is unreachable the client may return
   its on-disk cache; otherwise the load fails.
2. **Parse.** The document is a `.env` subset: `KEY=value`, comments only on
   their own line. Syntax errors, duplicate keys, a missing or wrong
   `RNACOS_SCHEMA_VERSION`, and unknown keys are rejected as a whole.
3. **Validate.** Each key is parsed by its family schema (levels, ranges,
   enums). One bad value rejects the document; there is no partial apply.
4. **Merge.** Accepted overrides are merged onto the **env baseline**, not onto
   the previous document. A key that disappears from the document therefore
   returns to its baseline value — that is the single-field rollback.
5. **Swap.** The new values are frozen, the snapshot reference is replaced in
   one assignment, and listeners are notified. A listener that throws is logged
   and does not block the others.
6. **Record.** The log line carries `version` (`revision#seq`), `source`, and
   the changed key names. Values are never logged; prompts appear only as
   digests, because prompt text can contain user-influenced wording.

A rejected document changes nothing: the previous snapshot stays in force and
the rejection is a warning with the reason and the offending key name.

## Sources and degradation

- `env` — the baseline, version `env#0`.
- `remote` — a document served by the center.
- `local-cache` — the client's disk cache after a failed load. Values may be
  older than the last publish; the snapshot says so. The cache is consulted
  only when a TCP probe fails: a reachable center must answer from the server,
  otherwise a cold start could apply a stale cached document and label it
  `remote`.

A subscription that outlives a center restart needs its own liveness signal —
the binding surfaces no disconnect event. A lightweight probe runs every 30
seconds: it warns once when the center goes away and logs recovery, while
requests keep reading the last snapshot.

`RNACOS_ENABLED=false` means no client, no network call, and no native module
loaded. A center that goes down later does not stop the process: it keeps the
last snapshot, keeps serving, and logs the failure. Restarting while the center
is down falls back to env (or to the disk cache, if mounted and enabled).

Deletion is not a rollback path. rnacos stops pushing a deleted `dataId`, so the
process would keep the last snapshot until someone restarts the center. Roll
forward by publishing a new revision.

## Boundaries

Only non-secret behaviour parameters are in the whitelist: AI and prompt
settings, retrieval budgets, queue concurrency and schedules, cache TTLs,
verification/token TTLs, storage bucket/region/signature limits, app metadata,
and ops knobs (log level, slow thresholds, metrics switch, rate limits).

Secrets and connection strings stay in `.env` and are read once at startup:
`DATABASE_URL`, `REDIS_URL`, JWT secrets, object-storage access keys, and every
provider `*_API_KEY`. Pasting one into the document rejects the whole document —
the center is not a secret store, and a rejected document is easier to notice
than a secret copied into a second place.

Some values are still startup-only even though they are non-secret (storage
provider selection, mail driver, module wiring). The whitelist is the complete
answer; when in doubt, check the template and the schema, which `docs:verify`
keeps in lockstep.
