# Prisma Query Typing Migration Plan

## Goal

Replace broad Prisma query result assertions with query-derived payload types so
Lucent keeps enum safety, relation shape safety, and local refactor safety
without relying on manual `as SomeRecord` casts.

## Why This Exists

Recent assistant and health-context work reached `pnpm typecheck = 0`, but the
code still contains query result assertions that can silently drift from:

- `prisma/schema.prisma`
- generated Prisma client enums and relation payloads
- the actual `select` / `include` used at each query site

The immediate examples fixed in this slice are:

- `src/modules/assistant/services/assistant-conversation.service.ts`
- `src/modules/user-health-context/types/user-health-context.types.ts`

They now demonstrate the preferred pattern:

1. define query args constants
2. validate them with `satisfies Prisma.XxxDefaultArgs`
3. derive record types with `Prisma.XxxGetPayload<typeof args>`
4. reserve `as` for narrow JSON or third-party boundaries only

## Preferred Pattern

```ts
const userArgs = {
  include: {
    profile: true,
  },
} satisfies Prisma.UserDefaultArgs;

type UserRecord = Prisma.UserGetPayload<typeof userArgs>;
```

For list/summary variants, define a second args object instead of hand-writing a
parallel DTO-like record type.

## Anti-Pattern To Remove

```ts
type UserRecord = {
  profile: {
    sexAtBirth: string | null;
  } | null;
};

const user = (await prisma.user.findFirst({
  include: userInclude,
})) as UserRecord | null;
```

Problems:

- enums widen to `string`
- query shape and record shape can drift independently
- relation field additions/removals are not checked
- refactors create false confidence

## Scope Queue

### Wave 1: Highest-value Prisma record cleanup

1. `src/modules/assistant/services/assistant-conversation.service.ts`
   Status: completed in this slice
2. `src/modules/user-health-context/types/user-health-context.types.ts`
   Status: completed in this slice
3. `src/modules/user-health-context/user-health-context.service.ts`
   Remove query result cast after the shared include-derived type is in place
4. assistant tool/read files with query-shape-local record aliases
5. medicine reminders and report context query helpers with similar patterns

### Wave 2: Boundary cleanup

Focus on files that still assert entire records returned by Prisma, especially:

- `as SomeRecord | null`
- `as SomeRecord[]`
- handwritten record aliases with enum fields typed as `string`

Keep these only where unavoidable:

- JSON payload narrowing
- test doubles
- third-party library boundaries

## Execution Steps Per File

1. Identify the exact Prisma query or shared include/select constant.
2. Replace freehand result types with `Prisma.XxxGetPayload<typeof args>`.
3. If one file needs multiple shapes, define multiple args constants.
4. Remove whole-result `as` assertions from `findFirst/findMany/create/update`.
5. Keep only narrow assertions for JSON payload parsing if needed.
6. Run the smallest relevant `pnpm typecheck` verification after each slice.

## Verification

Minimum check while iterating:

```powershell
pnpm typecheck
```

If a slice touches behavior rather than only types, also run the nearest tests
for the affected module.

## Observable Success Criteria

- `pnpm typecheck` stays green
- enum fields such as `role`, `status`, `kind`, `source`, `sexAtBirth` are no
  longer widened to `string` by local record aliases
- query result types change automatically when `select/include` changes
- broad Prisma result assertions become rare and intentional
