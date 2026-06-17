# Report Export PDF Productization Next

Last updated: 2026-06-17

## Goal

Continue the Lucent report export slice after the current PDF polish baseline.

Current baseline is already true:

- report PDF export is real
- PDF now has repeated header/footer chrome
- PDF now has page numbers
- PDF now has explicit PDF metadata

Next work should improve doctor-facing readability, not re-open the export contract.

## Scope

Keep the current backend contract and current real export set:

- `hospital + pdf + last_7_days`
- `monthly + pdf + last_30_days`
- `print + pdf + last_7_days`

Do:

- improve section readability inside the PDF template
- make long finding/pattern blocks easier to scan
- improve export wording only if it changes trust or legibility

Do not:

- add docx
- add export history list
- add worker queueing in the same slice
- redesign the API contract unless a real blocker appears

## Current Facts

- Source file: `src/modules/data-export/report-export-pdf.service.ts`
- Current template is still text-first, not chart-first
- Current unit coverage confirms:
  - PDF loads successfully
  - metadata is written
  - long content spills into multiple pages

## Recommended Next Steps

1. Reshape metrics into a more readable block
   - Prefer a compact two-column or card-like text layout over one long wrapped line
   - Keep the implementation simple inside `pdf-lib`; do not introduce a new rendering engine

2. Group findings and patterns more intentionally
   - At minimum, separate “needs attention” content from neutral/stable content
   - If grouping becomes noisy, fall back to ordering instead of introducing more labels

3. Improve exported wording for off-app use
   - Replace raw enum-like status strings where needed
   - Keep `generatedAt`, date range, and export kind obvious on the document itself

4. Add one more focused test only if the code shape changes materially
   - Do not chase brittle PDF text-extraction tests
   - Prefer assertions on page count, metadata, and coarse structural behavior

## Files Most Likely To Change

- `src/modules/data-export/report-export-pdf.service.ts`
- `src/modules/data-export/report-export-pdf.service.spec.ts`
- `docs/environment.md`
- `docs/TODO.md`

## Verification

- `pnpm test -- report-export-pdf.service.spec.ts`
- `pnpm build`
- `pnpm typecheck`

Use broader checks only if this slice starts touching shared report DTOs or service behavior outside PDF rendering.

## Done Signal

- exported PDF reads like a deliberate medical-support document rather than raw app text dump
- multi-page output remains stable
- no API contract change was needed
