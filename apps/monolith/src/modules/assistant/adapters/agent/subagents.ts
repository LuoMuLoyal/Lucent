/**
 * Sub-agent definitions (deepagents `task` delegation).
 *
 * ## Why the split is by domain, not by tool
 *
 * A sub-agent exists to give a **separate context window** to work that would
 * otherwise flood the parent's history with tool payloads: a page of DrugBank
 * passages, a range of daily records. Splitting by tool (`a get_records agent`,
 * `a search agent`) would just add hand-off cost — the parent already has all
 * the tools, so there is nothing to isolate.
 *
 * The three domains below differ in what their results *look like*, and that is
 * exactly what a sub-agent isolates:
 *
 * - `knowledge` — long retrieved prose and graph rows.
 * - `records` — many small structured rows over a date range.
 * - `analyst` — file and shell work, whose output is bulk text and never a
 *   fact the parent should quote directly.
 *
 * ## What these do *not* do
 *
 * They carry no tools of their own. `tools` is omitted, so each sub-agent
 * inherits the parent's tool set (`defaultTools`). The isolation is the
 * **context window**, not the capabilities: a records sub-agent that could not
 * read a record would be useless, and re-declaring the tool list per sub-agent
 * is a second registry that would drift from the first.
 */
import type { SubAgent } from 'deepagents';

/**
 * Descriptions are what the model reads to choose a sub-agent, so they state
 * *when to delegate* rather than what the agent is called. A description that
 * only names the domain ("knowledge agent") gives the model nothing to decide
 * with.
 */
export const ASSISTANT_SUBAGENTS: readonly SubAgent[] = [
  {
    name: 'knowledge',
    description:
      'Delegate drug and medical knowledge questions here: package-insert fields, DrugBank mechanism/interaction evidence, and typed graph reasoning. Use it when the answer requires reading through long retrieved passages, so those passages do not fill the main conversation.',
    systemPrompt: [
      'You research drug and medical knowledge.',
      'Use the retrieval tools you were given; do not answer from memory.',
      'Report what the sources say, which source each claim came from, and how confident you are.',
      'If the sources do not cover the question, say so — absence of evidence is a finding, not a gap to fill.',
    ].join(' '),
  },
  {
    name: 'records',
    description:
      "Delegate questions over the user's own recorded data here: daily records, sleep, meal analysis, profile, current medicines. Use it when reading a date range would return many rows, so the raw rows stay out of the main conversation.",
    systemPrompt: [
      "You read the user's own records.",
      'Answer only from what the tools return; never infer a record that was not returned.',
      'Carry the result envelope forward: coverage, time range, and ambiguities matter to whoever reads your summary.',
      'If a range has no data, say that plainly instead of describing an empty result as an answer.',
    ].join(' '),
  },
  {
    name: 'analyst',
    description:
      'Delegate file and shell work here: writing a script, parsing a file, computing over a dataset, producing a document. Use it when the work needs code execution rather than a lookup.',
    systemPrompt: [
      'You work with files and a shell.',
      'Prefer the file tools over shell text processing when both would do.',
      'State what you actually ran and what it produced, including failures.',
      'Never present a command you did not run as if it had run.',
    ].join(' '),
  },
];

/** Names of the declared sub-agents, for logging and capability reporting. */
export const ASSISTANT_SUBAGENT_NAMES: readonly string[] =
  ASSISTANT_SUBAGENTS.map((subagent) => subagent.name);
