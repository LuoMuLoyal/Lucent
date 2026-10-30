/**
 * Supported range of the client-owned layout document shape.
 *
 * ## Why a range and not "any version"
 *
 * `payload` is opaque to the server, so it cannot validate the document itself.
 * The one thing it *can* enforce is that the document was written by a client
 * whose format this backend agreed to store. Without it, a future client could
 * write a shape that every older client then fails to parse — and because the
 * server would have accepted it, nobody finds out until users report broken
 * pages.
 *
 * - Below `MIN`: the client is too old to know the current shape.
 * - Above `MAX`: the client is newer than this backend; storing it would break
 *   every other device on the same account.
 *
 * Both directions reject with 422 (`LAYOUT_SCHEMA_VERSION_UNSUPPORTED`) rather
 * than clamping or guessing: a half-understood layout is worse than falling
 * back to the client's built-in defaults.
 *
 * ## Bumping
 *
 * Adding an optional field to the payload does **not** need a bump — all clients
 * ignore what they do not know, and the server does not interpret the payload.
 * Bump `MAX` only when an older client would *misrender* the newer document.
 */
export const LAYOUT_SCHEMA_VERSION_MIN = 1;
export const LAYOUT_SCHEMA_VERSION_MAX = 1;

export function isSupportedSchemaVersion(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= LAYOUT_SCHEMA_VERSION_MIN &&
    version <= LAYOUT_SCHEMA_VERSION_MAX
  );
}
