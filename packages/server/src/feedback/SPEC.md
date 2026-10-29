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

Own the host-scoped lifecycle of the in-app survey invitation and the survey it offers. Count accepted user-authored messages, persist postponement, dismissal and the completed survey id plus iteration, load the launched PostHog survey, and offer one addressed invitation when that survey is due. The Settings entry reads the same survey and never postpones.

## Boundary

- **Owns:** validated `feedback.json` (`acceptedMessages`, `nextInvitationAt`, `dismissed`, `submittedSurveyId`, `submittedIteration`); the fixed 10-message initial/retry interval; one memory-only claimant client; `recordAcceptedMessage`; `respondToInvitation`; `completeSurvey`; the addressed publisher; the public-survey loader, submission parser and `survey sent` payload builder in `survey.ts`.
- **Public surface (barrel):** the lifecycle operations, survey source configuration, selection and refresh, submission parsing, the response builder, the publisher installer, and test resets.
- **Allowed deps:** `persistence` (`dataDir` only); `contracts` survey and invitation types; Node filesystem/path APIs; `fetch` for `GET /api/surveys/` in `survey.ts` only.
- **Forbidden:** importing `host` or analytics. The host passes in the survey endpoint analytics exposes and captures the payload this module builds. This module does not target people in PostHog or open a calendar.

## Get right

- A missing or malformed file starts at `{ acceptedMessages: 0, nextInvitationAt: 10, dismissed: false, submittedSurveyId: null, submittedIteration: null }`. An older file without the completion keys loads those as null. Every update writes a same-directory temporary file and atomically renames it over `feedback.json`.
- Counting continues after `dismissed`. `postpone` sets `nextInvitationAt = acceptedMessages + 10`; Take the survey also postpones, so closing the survey window unsent re-invites after ten more messages. `never` sets `dismissed` for good: a new survey or iteration never clears it, and a dismissal recorded by the retired interview invitation (its Never or Book) carries over. The Settings entry stays available. Completion stores the survey id and `current_iteration` in memory first and clears the claim, then writes the file; a failed write leaves the in-memory completion in force and the next accepted message persists it; the same id and iteration stay hidden, and the next iteration or a new id can show again.
- An invitation is delivered only when a launched survey is cached, unexpired and not completed (when a refresh is due, the offer waits for it), the count has reached `nextInvitationAt`, the invitation was not dismissed, and no client is claimed. The analytics setting and `--no-analytics` do not affect it. With no survey source configured, no refresh is scheduled.
- `survey.ts` selects the newest launched survey named `in-app-feedback`, re-reads the list at most every 15 minutes, treats its cached copy as gone an hour after the last successful read (failed reads and the retry throttle never extend it), and sends the client a narrow question DTO (open text, single and multiple choice with an optional Other, rating). Other question types, PostHog branching, display conditions and translations are not drawn. No endpoint and no successful fetch leave the survey hidden.
- A submission names the survey id and iteration the user answered and is checked against a fresh read (`confirmInAppSurvey`, which bypasses the 15-minute cache and rejects when the list cannot be read), never against the displayed copy. `surveyResponse` requires every non-optional answer and validates each against its question, so a changed or partial survey is never relabelled.
