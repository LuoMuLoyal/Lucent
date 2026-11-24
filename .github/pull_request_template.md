<!--
PR titles use the Conventional Commits format, one line:

  type(scope): short summary

Mark a breaking change with `!` after the type, and list old → new plus the
migration steps in the body:

  refactor(modules)!: shorten module, class and database object names

The title is the only field that reaches `git log --oneline` and the release
notes. "Fix bug" and "Update code" cannot be found six months later.
-->

## Summary

<!--
2–4 sentences covering three things: what changed, why it must change, and
which alternatives were rejected. A reader should be able to decide whether to
keep reading from this section alone.
-->

## Type of change

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] docs — documentation only
- [ ] refactor — code restructuring without behavior change
- [ ] perf — performance improvement
- [ ] test — test additions or fixes
- [ ] chore — tooling, dependencies, CI
- [ ] ci — CI/CD configuration

## Breaking changes

<!--
Delete this section when nothing breaks.

A change is breaking when downstream must change code, configuration, data or
deployment to upgrade safely. That includes renaming or removing public
functions, types, fields, constants, packages, modules, commands or flags;
changes to signatures, return values, error types, module paths, config keys or
environment variables; default behavior changes around persistence,
serialization, ordering, timeouts, retries or lifecycle; and HTTP route changes
where the old path no longer exists.

Answer all four when this section applies:

1. **Old → new**: list every mapping. Do not make readers open a link to find
   out what they have to change.
2. **Who breaks**: which repos, clients or scripts stop working.
3. **Upgrade steps**: ordered and executable, including preconditions such as
   data migrations or "drain the queue first".
4. **Rollback**: how to revert the code, whether the data can be reverted, and
   what to do when it cannot.
-->

## How to review

<!--
Fill this in for changes above roughly 20 files. Tell reviewers which files are
mechanical and which need real reading. Order the reading path, and include any
command that shrinks the diff (e.g. `git diff --color-moved`).
-->

## Verification

<!--
Tick only what you actually ran. When something was not run, say so and explain
how it will be covered — marking an unverified check as verified is worse than
leaving it unchecked.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm test:e2e:ci` | Not run (needs the full Postgres + Redis stack); will run in CI before merge |
-->

## Checklist

- [ ] `pnpm lint:check` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test:ci` passes
- [ ] `pnpm test:e2e:ci` passes
- [ ] API contract changed → ran `pnpm export:openapi` and committed `docs/reference/generated/openapi.json`
- [ ] Module structure changed → ran `pnpm docs:compodoc`
- [ ] Documentation updated (migration log; ADR if applicable)

## Related issues

<!-- Link any related issues, e.g. "Closes #123". -->
