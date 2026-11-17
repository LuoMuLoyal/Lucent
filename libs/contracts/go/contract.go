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
// The generator version is pinned in the directive below so two machines cannot
// produce different output from the same JSON.
package contracts

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 -config oapi-codegen.yaml ../../../docs/reference/generated/openapi.json
