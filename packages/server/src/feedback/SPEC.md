---
id: submodule-server-feedback
type: submodule-design
status: active
title: feedback — host-scoped survey prompts
parent: module-server
tags: [feedback, research]
depends-on: [module-contracts]
---

## Responsibility

Own the host-scoped lifecycle for the in-app survey prompt. Count accepted user-authored messages, persist postponement and the completed survey id plus iteration, and offer one addressed prompt when a launched survey is due. The settings pane reads the same survey and does not postpone.

## Boundary

- **Owns:** validated `feedback.json` (`acceptedMessages`, `nextInvitationAt`, `dismissed`, `submittedSurveyId`, `submittedIteration`); the fixed 10-message initial/retry interval; one memory-only claimant client; `recordAcceptedMessage`; `respondToInterview`; `completeSurvey`; an injected offer predicate and addressed publisher; the public-survey loader in `survey.ts`.
- **Public surface (barrel):** the lifecycle operations, survey selection and refresh, submission parsing, publisher and offer installers, and test resets.
- **Allowed deps:** `persistence` (`dataDir` only); `contracts` survey and interview types; Node filesystem/path APIs; `fetch` for `GET /api/surveys/` in `survey.ts` only.
- **Forbidden:** importing `host` or analytics. The host captures survey events and decides eligibility. This module does not target people in PostHog or open a calendar.

## Get right

- A missing or malformed file starts at `{ acceptedMessages: 0, nextInvitationAt: 10, dismissed: false, submittedSurveyId: null, submittedIteration: null }`. An older file without the completion keys loads those as null. Every update writes a same-directory temporary file and atomically renames it over `feedback.json`.
- Counting continues after `dismissed`. `postpone` sets `nextInvitationAt = acceptedMessages + 10`. `never` (and legacy `book`) set `dismissed`, which suppresses later usage prompts while leaving the settings survey available. Completion stores the survey id and `current_iteration` and clears the claim. The same id and iteration stay hidden; the next iteration or a new id can show again.
- A prompt is delivered only when the injected offer returns true, the count has reached `nextInvitationAt`, the prompt was not dismissed, and no client is claimed. Analytics being off does not suppress it, and neither does `--no-analytics`: that run still offers the prompt, but the host refuses submission and does not record completion. Offer exceptions count as false. With no survey source configured, a refresh is not scheduled.
- `survey.ts` selects the newest launched survey named `in-app-feedback`, keeps the last good copy for 15 minutes after a failure, and sends the client a narrow question DTO. No project key and no successful fetch leave the survey hidden.
