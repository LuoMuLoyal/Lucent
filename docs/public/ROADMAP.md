# Luminous Roadmap

Last updated: 2026-05-30

## Current Reality

- Frontend has been reset to a clean five-tab shell.
- Auth/network/i18n/design-token foundations are in place.
- Login/register pages are minimal and still need UX completion.
- Medicine, reminder, scan, and real Today data flows are not restored yet.
- Lucent is the target backend; legacy backend remains historical/deployed context.

## Phase 1 - Medication Loop

Goal: make `search medicine -> view detail -> add medicine -> set reminder -> check in -> record reaction` trustworthy and demo-ready.

Milestones:

1. Keep `/api/v1`, envelope, auth, and e2e baseline stable.
2. Import a small verified medicine dataset into Lucent.
3. Provide Lucent medicine search/detail APIs.
4. Move Flutter medicine search/detail to Lucent.
5. Rebuild reminders, check-in, and reaction records.
6. Use AI only as an explanation layer, not the source of medicine facts.

## Phase 2 - Personal Health Record

- Vitals, symptoms, reports, mood, water, and exercise records.
- Health timeline and weekly/monthly summaries.
- Preventive screening and environment reminders.

## Phase 3 - Proactive Health Partner

- Personalized reminders based on profile, medicine, and trends.
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

Boundary: no diagnosis, no doctor replacement, no fabricated medicine facts.
