# Luminous Roadmap

Last updated: 2026-06-06

## Current Reality

- Frontend has been reset to a clean five-tab shell.
- Auth/network/i18n/design-token foundations are in place.
- Login/register pages are minimal and still need UX completion.
- Medicine knowledge, personal records, reminders, scan, and real Today data flows are not restored yet.
- Lucent is the target backend; legacy backend remains historical/deployed context.

## Phase 1 - Health Copilot Foundation

Goal: make Lucent a trustworthy personal health copilot backend: source-grounded knowledge, user-owned health context, and safe AI explanation boundaries.

Milestones:

1. Keep `/api/v1`, envelope, auth, and e2e baseline stable.
2. Import the English DrugBank dataset as the default medicine knowledge source.
3. Import the Chinese medicine product/package-insert dataset as a regional execution source.
4. Provide source-aware medicine search/detail APIs with stable common response fields and source-specific detail payloads.
5. Reconnect Flutter to Lucent for medicine knowledge lookup, Today data, and user-owned health context.
6. Use AI only as a source-grounded explanation and planning layer, not as the source of medicine facts.

## Phase 2 - Personal Health Context

- Vitals, symptoms, reports, mood, water, and exercise records.
- Health timeline and weekly/monthly summaries.
- Preventive screening and environment reminders.
- User profile context for age, sex, pregnancy/lactation state, allergies, conditions, and current medicines.

## Phase 3 - Proactive Health Partner

- Personalized reminders and suggestions based on profile, medicine knowledge, records, and trends.
- Mental health tracking and graded suggestions.
- Specialist record OCR for dental, eye, and hearing data.

## Phase 4 - Multi-Device

- Watch: quick check-ins and lightweight reminders.
- Desktop: reports and long-term trend review.
- Web: family care view and expiring doctor-share links.

## Later

- Women's health
- Family collaboration
- Exploratory hardware and skin-photo workflows

## Active Contracts

- `reminder-contract.md` — notification/reminder boundary: local vs backend, planned API surface, migration path. No push delivery (FCM/APNs) in scope.
- `environment-contract.md` — environment snapshot API: pollen, UV, air quality, temperature. Static reference data first, external API optional later.

Boundary: no diagnosis, no doctor replacement, no fabricated medicine facts.
