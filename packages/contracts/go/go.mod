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
	github.com/dprotaso/go-yit v0.0.0-20220510233725-9ba8df137936 // indirect
	github.com/getkin/kin-openapi v0.142.0 // indirect
	github.com/go-openapi/jsonpointer v0.23.1 // indirect
	github.com/go-openapi/swag/jsonname v0.26.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/oapi-codegen/oapi-codegen/v2 v2.8.2 // indirect
	github.com/oasdiff/yaml v0.1.1 // indirect
	github.com/oasdiff/yaml3 v0.0.14 // indirect
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.2 // indirect
	github.com/speakeasy-api/jsonpath v0.6.3 // indirect
	github.com/speakeasy-api/openapi v1.24.0 // indirect
	github.com/vmware-labs/yaml-jsonpath v0.3.2 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/mod v0.38.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	golang.org/x/tools v0.48.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

tool github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen
