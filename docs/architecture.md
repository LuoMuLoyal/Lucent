# Lucent Architecture

## Module Dependency Graph

```mermaid
graph TD
    subgraph "Public APIs"
        auth["auth<br>/auth/*"]
        account["account<br>/account/*"]
        medicines["medicines<br>/medicines/*"]
        environment["environment<br>/environment"]
        support["support-resources<br>/public/*"]
    end

    subgraph "User Resources (RouterModule /user/*)"
        assistant["assistant"]
        daily["daily-records"]
        dataExport["data-export"]
        files["files"]
        doseLogs["medicine-dose-logs"]
        reminders["medicine-reminders"]
        notifications["notifications"]
        reports["reports"]
        today["today-analysis"]
        healthCtx["user-health-context"]
        settings["user-settings"]
    end

    subgraph "Internal Services"
        llm["llm-runtime<br>(AI model factory)"]
        user["user<br>(data layer)"]
        testing["testing-support<br>(test only)"]
    end

    subgraph "Infrastructure"
        prisma["PrismaService"]
        mail["MailService"]
        i18n["I18nService"]
        jwt["JwtService"]
    end

    %% Public API dependencies
    auth --> user
    auth --> notifications
    auth --> jwt
    account --> auth

    %% User resource dependencies
    assistant --> llm
    assistant --> daily
    assistant --> reminders
    assistant --> healthCtx
    assistant --> settings
    daily --> llm
    reports --> llm
    reports --> assistant
    today --> llm
    today --> assistant
    today --> notifications
    dataExport --> reports
    dataExport --> notifications
    medicines --> llm
    files --> daily

    %% Infrastructure
    auth --> prisma
    user --> prisma
    daily --> prisma
    notifications --> prisma
    reports --> prisma
    today --> prisma
    healthCtx --> prisma
```

## AI Pipeline Architecture

All AI analysis modules follow a three-layer pattern:

```mermaid
graph LR
    subgraph "Layer 1: Context"
        CC["Context Service<br>build(userId, dto) → context"]
    end

    subgraph "Layer 2: Generation"
        GC["Copy Service<br>(i18n prompt copy)"]
        GEN["Generator Service<br>extends BaseAiGeneratorService"]
        CC --> GEN
        GC --> GEN
    end

    subgraph "Layer 3: Policy & Persistence"
        POL["Safety Policy<br>(forbidden patterns)"]
        PERSIST["persistSummary()"]
        GEN --> POL
        POL --> PERSIST
    end
```

### Implementations

| Module                | Context                              | Generator                             | Model Role |
| --------------------- | ------------------------------------ | ------------------------------------- | ---------- |
| ReportsAiSummary      | ReportsAiSummaryContextService       | ReportsAiSummaryGeneratorService      | `analysis` |
| TodayAnalysis         | TodayAnalysisContextService          | TodayAnalysisGeneratorService         | `analysis` |
| DailyRecordCandidates | (inline in service)                  | DailyRecordCandidatesGeneratorService | `language` |
| Assistant             | (chat-based, different architecture) | —                                     | `chat`     |

## Directory Structure Convention

See `AGENTS.md` → Module Subdirectory Whitelist for the complete governance rules.

```
src/modules/{module}/
├── dto/               # Data Transfer Objects (must have index.ts)
│   └── index.ts       # Barrel export
├── services/          # All business-logic services
│   ├── {module}.service.ts
│   ├── {module}-mapper.service.ts  # Mapper convention
│   └── ownership.service.ts        # Ownership verification convention
├── guards/            # NestJS Guards (only .guard.ts, CanActivate)
├── config/            # Module-level configuration (extended)
├── types/             # Module-level TypeScript types (extended)
├── {module}.controller.ts
└── {module}.module.ts
```

## API Route Architecture

Routes are configured via `RouterModule` in `AppModule`. Controllers declare bare resource paths; the prefix is centralized.

| Prefix         | Modules                                                                                                                                                | Via                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `/auth/*`      | auth                                                                                                                                                   | Controller `@Controller('auth')`                  |
| `/account/*`   | account                                                                                                                                                | Controller `@Controller('account')`               |
| `/medicines/*` | medicines                                                                                                                                              | Controller `@Controller('medicines')`             |
| `/environment` | environment                                                                                                                                            | Controller `@Controller('environment')`           |
| `/public/*`    | support-resources                                                                                                                                      | Controller `@Controller('public')`                |
| `/testing/*`   | testing-support                                                                                                                                        | Controller `@Controller('testing/fullstack-e2e')` |
| `/user/*`      | assistant, daily-records, data-export, files, health-context, medicine-dose-logs, medicine-reminders, notifications, reports, settings, today-analysis | `RouterModule.register()`                         |

## Error Handling

All error responses use `api-errors.ts` helpers (`notFound`, `badRequest`, `unauthorized`, `forbidden`, `conflict`) with i18n keys. The global envelope is `{ code: ResultCode, message: string, data?: T }`.

## Database

- **ORM**: Prisma 7 (client provider: `prisma-client`)
- **Schema**: `prisma/schema.prisma`
- **Generated client**: `src/generated/prisma/`
- **Key conventions**: `@map()` for snake_case columns, `@db.Timestamptz(3)` for timestamps, soft-delete via `deletedAt`
