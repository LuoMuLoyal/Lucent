/**
 * Layout surface identifiers (ADR-0024 domain layer).
 *
 * A *surface* is a place in the client that hosts components: a tab page, or
 * the tab chrome (bottom bar icons / labels / order). The server never renders
 * anything, so it treats surfaces as opaque names — but it must still reject
 * unknown ones, or a typo silently creates a row nobody reads.
 *
 * The list is closed on purpose: it is the wire contract between Lucent and
 * Luminous (`SurfaceId.wireValue` on the client). Adding one is a contract
 * change, not a data change — that is why this lives in code rather than in a
 * lookup table.
 */
export const LAYOUT_SURFACES = [
  'today',
  'record',
  'medicine',
  'review',
  'mine',
  'tab_chrome',
] as const;

export type LayoutSurface = (typeof LAYOUT_SURFACES)[number];

export function isLayoutSurface(value: string): value is LayoutSurface {
  return (LAYOUT_SURFACES as readonly string[]).includes(value);
}
