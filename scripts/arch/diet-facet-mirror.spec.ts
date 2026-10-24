import { MEAL_ANALYSIS_ITEM_KINDS } from '../../src/modules/daily-records/schemas/meal-analysis.schema.js';
import { DIET_FACET_KINDS } from '../../src/modules/today-suggestion/domain/signal/diet-facet.js';

/**
 * Guards the Daily Guidance ↔ Health Log facet vocabulary boundary.
 *
 * `today-suggestion` declares its own `DietFacetKind` (9 kinds) instead of
 * importing `daily-records`' `MealAnalysisItemKind` (11 kinds) — the consumer
 * owns the contract, so upstream can add a kind without downstream changing.
 * See `domain/signal/diet-facet.ts` for that reasoning.
 *
 * ## What that design gives up, and what this test buys back
 *
 * The projection drops unknown kinds and logs it. But a log cannot distinguish
 * **upstream added a kind** (fine — we ignore it) from **upstream renamed one we
 * depend on** (a silent loss of behaviour: the rule keeps its branch, no data
 * ever reaches it, nothing fails).
 *
 * So this asserts the one direction that must never break: **every kind we
 * claim to consume still exists upstream.** Additions stay legal; a rename or a
 * removal goes red here.
 *
 * ## Why the guard lives in `scripts/`
 *
 * `domain/` may not import `daily-records` (`ddd-domain-purity`), and
 * `daily-records` exports the kinds array only from its schema module — so no
 * in-`src` location can see both sides. `depcruise` scans `src` only, so a test
 * under `scripts/` can. Same arrangement as
 * `scripts/arch/risk-level-mirror.spec.ts`.
 *
 * Runs via `pnpm test:tools` (part of `test:ci`).
 */
describe('diet facet vocabulary mirror', () => {
  const upstream = new Set<string>(MEAL_ANALYSIS_ITEM_KINDS);

  it('every consumed kind still exists upstream', () => {
    const missing = DIET_FACET_KINDS.filter((kind) => !upstream.has(kind));
    expect(
      missing,
      `today-suggestion consumes facet kind(s) that no longer exist upstream: ` +
        `${missing.join(', ')}. If they were renamed, update ` +
        `domain/signal/diet-facet.ts (and the rule branches that use them).`,
    ).toEqual([]);
  });

  it('the consumed list is a strict subset — balance/other stay out', () => {
    // Not a style preference: these two are not actionable diet dimensions, so
    // no rule branches on them. Adding one here without a rule branch would
    // re-create the "present in the type but never consumed" problem the
    // projection exists to avoid.
    expect(DIET_FACET_KINDS).not.toContain('balance');
    expect(DIET_FACET_KINDS).not.toContain('other');
  });

  it('is not accidentally empty', () => {
    // An emptied list would make the subset assertion above pass vacuously.
    expect(DIET_FACET_KINDS.length).toBeGreaterThan(0);
    expect(upstream.size).toBeGreaterThan(0);
  });
});
