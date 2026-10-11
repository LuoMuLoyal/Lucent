/**
 * Structured fact arguments must not carry JSON `null` values.
 *
 * `arguments` is published as a free-form object, and the generated Dart client
 * therefore types it `Map<String, Object>` — non-nullable values. One null
 * (an active event's `endedAt`, an ended event without a confirmed `outcome`,
 * a missing water/sleep trend) makes that client's `checked` deserializer throw
 * `type 'Null' is not a subtype of type 'Object'`, which surfaces as an
 * unrecoverable error state in the app while the API keeps answering 200.
 *
 * Consumers read arguments defensively, so an absent key and a null value are
 * equivalent: producers omit absent keys instead of sending null.
 */
export function compactFactArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}
