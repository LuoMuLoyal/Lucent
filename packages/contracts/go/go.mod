// Contract types and client for the Lucent HTTP API, generated from the
// published OpenAPI document.
//
// Why Go has its own copy: `docs/reference/generated/openapi.json` is the
// language-neutral source of truth, and each consumer language derives its own
// bindings from it. Sharing the TypeScript types across the boundary is not
// possible, and hand-writing Go structs would drift on the first endpoint
// change — generation plus a drift check is what keeps both sides honest.
//
// The module path intentionally ends in `contracts` so Turborepo derives the
// package name `contracts` (it uses the last path component).
module github.com/LuoMuLoyal/lucent/contracts

go 1.26.2

require github.com/oapi-codegen/runtime v1.9.0

require (
	github.com/apapsch/go-jsonmerge/v2 v2.0.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
)
