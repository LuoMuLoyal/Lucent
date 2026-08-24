# ADR-0002: AI Pipeline Three-Layer Architecture

- **Status**: accepted
- **Date**: 2026-06-12
- **Deciders**: LuoMuLoyal

## Context

The backend needed AI capabilities across multiple domains: Today health analysis, Report summary
generation, daily record candidate extraction from natural language, and an interactive assistant.
These features share common AI infrastructure (model selection, prompt management, safety
filtering) but have distinct business logic.

## Decision

Adopt a three-layer AI pipeline architecture:

1. **Context Layer** — gathers and validates user context, settings, and data relevant to the
   request
2. **Generation Layer** — assembles prompts, invokes the LLM, and streams/collects the response
3. **Policy & Persistence Layer** — applies safety filters, transforms the AI output into
   domain-typed responses, and persists results

A dedicated `LlmRuntimeModule` / `LlmRuntimeService` provides OpenAI-compatible model creation,
abstracted from individual feature modules.

## Options Considered

| Option                                              | Pros                                                                        | Cons                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Three-layer pipeline with shared runtime            | Clear separation, reusable runtime, feature modules own only business logic | More files/abstraction upfront                                                          |
| Each feature module owns its own AI code end-to-end | Simpler per-module                                                          | Duplicated model config, prompt safety gaps, harder to enforce consistent safety policy |
| Full LangGraph agent for everything                 | Maximum flexibility                                                         | Over-engineered for non-agent features (analysis, extraction, report gen)               |

## Consequences

- `LlmRuntimeService` is the single point for model/provider configuration
- Feature modules (TodayAnalysis, Reports, DailyRecords, Assistant) own their domain logic only
- Safety policy is centralized in the Policy layer
- Assistant module uses LangGraph agent within the Generation layer, while simpler features use
  direct LLM calls
- Role-based AI configuration: analysis, vision, language, chat, chat compression, embedding — each
  can target different models/providers
