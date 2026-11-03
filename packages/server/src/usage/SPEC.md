---
id: submodule-server-usage
type: submodule-design
status: active
title: usage — subscription limits for the sidebar panel
parent: module-server
depends-on: [module-contracts]
references: [submodule-server-auth, submodule-server-host]
tags: [usage, providers, panel]
---

## Responsibility

Answers one question for the sidebar's *Limits* block: what is left on each subscription the operator
pays for. Each provider is asked through whatever it actually exposes — a documented endpoint, an
undocumented one with a locally stored token, or nothing at all — and the answer is normalized into
windows (`usedPercent` + `resetsAt`) or money (`usedUsd` / `limitUsd`).

## Boundary

- **Owns:** the per-provider collectors, their tolerant parsers, the one-minute snapshot cache, and
  `providerId` → usage rows. `readSubscriptionUsage` is the whole surface; the host exposes it as
  `usage.subscriptions`.
- **Credential access:** pi-owned providers (Anthropic, OpenRouter) are read through `ModelRuntime` —
  the caller passes `readPiProviderToken`, so this module never parses `auth.json`. The Codex CLI and
  Antigravity keep credentials in their own files (`~/.codex/auth.json`, `~/.gemini/oauth_creds.json`);
  those are not pi's, so they are read directly here.
- **Forbidden:** importing `agent` (the caller supplies the token reader) and letting any credential
  value reach the snapshot, a log line, or the wire.

## Provider states

A row states only what was observed, so the panel never invents numbers:

- `ok` — the provider answered with windows and/or money.
- `sign-in` — Antigravity only: credentials are missing, expired, or the quota call refused them. The
  row stays visible and asks for a fresh sign-in.
- `unsupported` — OpenCode Go, Kimi Coding and DeepSeek expose no limits at all; the panel folds them
  into one collapsed group.
- `unavailable` — refused, errored, or unreachable. The panel hides the row, so a provider whose access
  is closed (Anthropic answering `oauth_not_allowed_for_organization`) simply does not appear until it
  starts answering again.

## Sources (as observed 2026-11)

| Provider | Request | Credential |
|---|---|---|
| Codex | `GET https://chatgpt.com/backend-api/wham/usage` | `~/.codex/auth.json` → `tokens.access_token` (+ `account_id`) |
| Claude | `GET https://api.anthropic.com/api/oauth/usage`, `anthropic-beta: oauth-2025-04-20` | pi `anthropic` |
| Antigravity | `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` | `~/.gemini/oauth_creds.json` |
| OpenRouter | `GET https://openrouter.ai/api/v1/key` | pi `openrouter` |

Codex, Claude and Antigravity are undocumented endpoints: every parser tolerates a changed shape by
returning `unavailable` rather than a guessed percentage. Antigravity's Google token cannot be refreshed
here — only the Antigravity app can, which is why an expired token is `sign-in`, not an error.

## Known limitations

- The token files are read on every cache miss; a provider that rotates credentials between reads is
  followed, but a stale token inside its own file is reported, not repaired.
- Snapshot TTL is one minute for all providers together; there is no per-provider backoff.
