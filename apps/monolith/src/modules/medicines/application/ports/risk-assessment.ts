/**
 * DI token for the `RiskAssessment` aggregate store (`application/ports`).
 *
 * The port interface itself lives in the domain
 * (`domain/safety/risk-assessments.ts`), next to the aggregate it serves. Only
 * the token belongs here: `domain/` must not import `@nestjs/common`, and the
 * token is a wiring detail, not domain language.
 *
 * Bound in `medicines.module.ts` to `PrismaRiskAssessmentStore`.
 */

export const RISK_ASSESSMENT_STORE = 'RISK_ASSESSMENT_STORE';
