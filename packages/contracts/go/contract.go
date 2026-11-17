// Package contracts holds Go bindings for the Lucent HTTP contract.
//
// The file `openapi.gen.go` is generated from
// `docs/reference/generated/openapi.json`; do not edit it by hand. The JSON
// document is the language-neutral source of truth shared with the TypeScript
// backend and Python sidecar, so every language derives its own bindings rather
// than sharing types across a process boundary.
//
// Regenerate with:
//
//	go generate ./...
//
// The generator is a **module tool** (the `tool` directive in go.mod), not a
// `go run pkg@version` invocation: the version is resolved from the lockfile like
// any other dependency, so generation never needs to reach the network on a
// machine that already has modules downloaded — and cannot silently pick up a
// newer release.
package contracts

//go:generate go tool oapi-codegen -config oapi-codegen.yaml ../../../docs/reference/generated/openapi.json
