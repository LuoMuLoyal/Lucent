# AI Boundary Confirmation

Last updated: 2026-07-01

## Decision Record

These decisions were made after reviewing the current Today/Report/Assistant AI implementations. They settle the open questions in `Lucent/docs/TODO.md` and `Luminous/plans/2026-06-12-remaining-backlog.md` workstream 5.

### Decision 1: Monthly Report AI uses bounded linear pattern

**Chosen:** Bounded linear (same as Today / Report weekly)

**Reasoning:**

- Monthly report input is a predictable 30-day aggregation — all facts can be provided in a single prompt
- Output has a fixed structure (summary + bullets + score) — Zod schema is appropriate
- Bounded linear is faster (1 LLM call), cheaper, and more reliable than agent
- No need for tool-based on-demand data querying

**Implementation sketch:**

```
ReportsAiSummaryGeneratorService (existing)
  ├── generate(context, promptCopy) → ReportSummaryStructuredOutput
  └── generateStream(context, promptCopy) → stream<ReportSummaryStructuredOutput>

MonthlyReportGeneratorService (new)
  ├── generate(monthlyContext, promptCopy) → MonthlyReportStructuredOutput
  └── generateStream(monthlyContext, promptCopy) → stream<MonthlyReportStructuredOutput>
```

### Decision 2: Extract shared StructuredAnalysisGenerator<T>

**Chosen:** Extract — after monthly report if the pattern proves stable, not before

**Reasoning:**

- Today + Report generators share ~80% code but diverge in prompt/schema/context
- A generic `StructuredAnalysisGenerator<T>` would reduce duplication
- Risk of premature abstraction — wait until 3 generators exist (after monthly) to confirm the pattern
- If monthly turns out to need a different shape, the abstraction would be wrong

**Future target:**

```typescript
@Injectable()
class StructuredAnalysisGenerator<T> {
  constructor(private readonly llm: LlmRuntimeService) {}

  async generate(opts: {
    toolName: string;
    schema: z.ZodType<T>;
    buildSystemPrompt: () => string;
    buildUserPrompt: (context: unknown) => string;
    context: unknown;
  }): Promise<T>;

  async generateStream(opts: ..., onSummary: (s: string) => void): Promise<T>;
}
```

### Decision 3: Agent boundary — only for branching/tool-use scenarios

**Chosen:** Keep agent restricted to Assistant; do not retro-fit bounded linear flows

**Rules:**

- Agent (LangGraph) is for: multi-turn conversation, tool-calling, branching, retrieval
- Bounded linear is for: facts→summary transformations, structured output from known input
- Do NOT convert Today/Report to agent "for consistency"
- Only introduce agent for a new feature if it genuinely needs tool use or multi-step reasoning

### Implication for existing code

No code changes. These decisions are constraints on future work:

| What                         | Rule                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Monthly Report AI            | Start as bounded linear; reuse `ai-copy.ts` for locale-aware prompts                 |
| New AI features              | Default to bounded linear; escalate to agent only with concrete tool-use requirement |
| Today / Report generators    | Leave as-is; don't refactor to agent                                                 |
| `ai-copy.ts`                 | Already shared; extend with monthly-specific keys                                    |
| Shared generator abstraction | Defer until monthly report proves the pattern                                        |

## Done Signal

- [x] AI architecture boundary documented
- [x] Next monthly AI feature has a clear starting pattern
- [x] Existing bounded linear flows are protected from agent refactors
- [x] `remaining-backlog.md` workstream 5 marked complete
