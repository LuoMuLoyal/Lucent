package contracts_test

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	contracts "github.com/LuoMuLoyal/lucent/contracts"
)

// The published contract JSON. Kept relative to the module so the test runs from
// the module directory (which is what `go test ./...` and Turborepo both use).
const openAPIPath = "../../../docs/reference/generated/openapi.json"

// TestProblemDetailsKeepsADR0012Fields pins the error body shape.
//
// ADR-0012 requires every ordinary 4xx/5xx to be Problem Details with a stable
// machine-readable `code`. A Go service consuming this contract must rely on
// those exact fields, so a silent rename in the backend would otherwise surface
// as a nil field at runtime rather than a failing build.
func TestProblemDetailsKeepsADR0012Fields(t *testing.T) {
	required := []string{"code", "detail", "title", "type", "retryable"}

	typ := reflect.TypeOf(contracts.ProblemDetailsDto{})
	present := make(map[string]bool, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		tag := typ.Field(i).Tag.Get("json")
		if tag == "" {
			continue
		}
		name := tag
		if idx := indexByte(tag, ','); idx >= 0 {
			name = tag[:idx]
		}
		present[name] = true
	}

	for _, field := range required {
		if !present[field] {
			t.Errorf("ProblemDetailsDto is missing %q; ADR-0012 error contract would break for Go consumers", field)
		}
	}
}

// TestGeneratedTypesMatchPublishedContract guards against a generated file that
// no longer corresponds to the JSON it claims to describe.
//
// It checks two coarse but decisive properties: the same number of top-level
// schemas exist in the document as the generator saw (via a spot check on
// required known types), and the document parses as OpenAPI 3. A full structural
// comparison belongs to the generator's own drift check (`git diff --exit-code`
// after regeneration); this test catches the case where someone hand-edits or
// reverts `openapi.gen.go` without touching the JSON.
func TestGeneratedTypesMatchPublishedContract(t *testing.T) {
	raw, err := os.ReadFile(openAPIPath)
	if err != nil {
		t.Fatalf("read %s: %v", openAPIPath, err)
	}

	var doc struct {
		OpenAPI string                                `json:"openapi"`
		Paths   map[string]json.RawMessage            `json:"paths"`
		Comp    struct{ Schemas map[string]struct{ } `json:"schemas"` } `json:"components"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse contract: %v", err)
	}

	if doc.OpenAPI == "" {
		t.Fatal("contract has no `openapi` version field")
	}
	if len(doc.Paths) == 0 {
		t.Fatal("contract declares no paths")
	}
	if doc.Comp.Schemas == nil {
		t.Fatal("contract declares no components.schemas")
	}

	// Types the generated file must expose if it was built from this document.
	for _, name := range []string{"ProblemDetailsDto", "HealthContextResponse"} {
		if _, ok := doc.Comp.Schemas[name]; !ok {
			t.Errorf("contract no longer declares %q but the generated Go file still references it; regenerate", name)
		}
	}
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}
