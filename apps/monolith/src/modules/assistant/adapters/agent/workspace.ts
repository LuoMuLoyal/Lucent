/**
 * Workspace resolution for the shell + filesystem backend.
 *
 * ## What this is not
 *
 * There is no sandbox here. The shell runs with the host process's authority:
 * no namespace, no cgroup, no seccomp, no network isolation. `LocalShellBackend`
 * says so itself — "Commands are executed directly on the host system without
 * any sandboxing, process isolation, or security restrictions."
 *
 * That was a deliberate decision for this phase, not an oversight. What this
 * module still does, because it costs nothing and removes the two failure modes
 * that happen without an attacker:
 *
 * 1. **A dedicated working directory per conversation.** Without it, a shell
 *    command's `pwd` is the repository root — the same directory that holds
 *    `.env.development` with the database URL and API keys, and a mistaken
 *    `rm -rf *` would take the source tree with it. The agent gets its own
 *    scratch tree instead.
 * 2. **A scrubbed environment.** Even with a dedicated cwd, an inherited
 *    environment hands every secret the process holds to anything the model
 *    runs (`env`, a crash report, a request made by a careless script). The
 *    scrub matches DSH's: drop names matching `/KEY|PASSWORD|SECRET|TOKEN/i`
 *    plus the harness's own `DSH_*`.
 *
 * Anything that *does* need a real secret (a database connection to run a
 * query) has to be passed explicitly by whoever builds the agent, which is the
 * point: an implicit grant is invisible in review, an explicit one is not.
 *
 * ## Path traversal
 *
 * `virtualMode` is on, so the file tools treat the workspace as a virtual root
 * and reject `..` / `~` and anything resolving outside it. That fence covers
 * `ls` / `read_file` / `write_file` / `edit_file` / `glob` / `grep` only —
 * **it does not constrain shell commands**, whose paths are the OS's to
 * interpret. The two are separate fences and only one of them is here.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Prefix for every conversation workspace directory. */
const WORKSPACE_PREFIX = 'lucent-agent-';

/**
 * Environment variables never handed to a shell command.
 *
 * Three families: anything that looks like a credential, connection strings
 * (a bare `DATABASE_URL` carries a password but matches none of the credential
 * words), and the harness's own namespace (which carries paths and flags that
 * are meaningless inside a scratch directory and noisy if leaked into logs).
 */
const SCRUBBED_ENV = /KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL|URL|DSN|CONN/i;
const SCRUBBED_PREFIXES = ['DSH_'];

/**
 * Returns a copy of `source` with credential-looking names removed.
 *
 * Exported for testing: the scrub is a security-shaped rule, and a rule that is
 * only exercised through the backend's spawn path is one refactor away from
 * silently disappearing.
 */
export function scrubEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value == null) continue;
    if (SCRUBBED_ENV.test(name)) continue;
    if (SCRUBBED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Absolute path of the scratch directory for one conversation.
 *
 * A fresh conversation and a resumed one get different directories on purpose:
 * resuming a thread must not inherit files a previous session's shell left
 * behind, because nothing in that directory is trustworthy across sessions.
 *
 * `conversationId` is used verbatim after a sanity check. It reaches this
 * function from the request body, and an unchecked value like `../../etc` would
 * silently point the workspace at an arbitrary directory — the one path-traversal
 * risk this module cannot delegate to `virtualMode`, since the workspace root is
 * chosen before any tool runs.
 */
/**
 * Monotonic suffix for anonymous workspaces.
 *
 * `Date.now()` alone collides: two turns in the same millisecond would share a
 * directory, and the second would see the first's files. A counter makes each
 * call distinct within a process, and the pid keeps processes apart.
 */
let ephemeralCounter = 0;

export function resolveAgentWorkspace(conversationId?: string): string {
  const suffix =
    conversationId != null && /^[A-Za-z0-9_-]{1,64}$/.test(conversationId)
      ? conversationId
      : `ephemeral-${String(process.pid)}-${String((ephemeralCounter += 1))}`;
  const workspace = join(tmpdir(), `${WORKSPACE_PREFIX}${suffix}`);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

/** Command timeout (seconds) for one shell invocation. */
export const AGENT_SHELL_TIMEOUT_SECONDS = 60;

/** Output cap (bytes) captured from one shell invocation. */
export const AGENT_SHELL_MAX_OUTPUT_BYTES = 100_000;
