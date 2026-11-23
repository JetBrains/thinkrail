---
"@thinkrail/pi-session-insights": minor
---

pr: #1464
commit: 3353327f4681fd570c74abf7fc4b25ffd96af512

An Overview for library consumers: `buildOverviewCards`, `composeOverview` and `parseOverviewParams`
compose one session's cards (what happened, plan, cost, errors, context, files, subagents, turns,
findings) from one trace snapshot, served as the new `session.overview` query (payload version 11).
A session now ends at its last work, so a model or thinking-level change appended when a chat is
reopened no longer stretches its wall time; shell commands that write into a file count as edits in
activity and sequences; and export paths in `/insights` reports are masked like the rest of the text.
