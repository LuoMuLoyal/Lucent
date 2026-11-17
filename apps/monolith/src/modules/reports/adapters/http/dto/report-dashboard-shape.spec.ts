import { describe, expectTypeOf, it } from 'vitest';

import type { ReportDashboardQuery } from '../../../application/ports/dashboard.js';
import type { ReportRange } from '../../../application/read_models/dashboard/report-range.js';
import type {
  ReportDashboardQueryDto,
  ReportRange as DtoRange,
} from '../../../application/read_models/dashboard/report-dashboard-query.js';

/**
 * The dashboard query shape exists twice on purpose (ADR-0024 D2):
 * `ddd-application-no-infra-or-adapters` forbids `application/` from importing
 * `adapters/`, so the use case's input vocabulary lives in
 * `application/ports/dashboard.ts` while the HTTP DTO keeps the zod schema.
 *
 * **Bidirectional on purpose.** A one-way `satisfies` only catches "the
 * application shape lost a field"; it misses "the schema gained a field the use
 * case never reads", which is the drift direction that actually happens —
 * contract edits start in the schema.
 */
describe('dashboard query shape mirrors the application port', () => {
  it('mirrors the query shape', () => {
    expectTypeOf<ReportDashboardQueryDto>().toEqualTypeOf<ReportDashboardQuery>();
  });

  it('mirrors the range vocabulary', () => {
    expectTypeOf<DtoRange>().toEqualTypeOf<ReportRange>();
  });
});
