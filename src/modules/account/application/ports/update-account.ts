/**
 * Application-layer shape of the `PATCH /account` command.
 *
 * Lives here rather than in `adapters/http/dto/update.ts` because the use case
 * and its tests depend on it: importing an `adapters/` path from `application/`
 * is what `ddd-application-no-infra-or-adapters` forbids (ADR-0024 §4.2). The
 * adapter's zod schema pins itself to this type with `satisfies`, so the wire
 * contract and the command cannot drift apart.
 */
export interface UpdateAccountCommand {
  nickname?: string | undefined;
  avatar?: string | undefined;
}
