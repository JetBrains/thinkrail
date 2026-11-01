---
id: submodule-server-agent-antigravity
type: submodule-design
status: active
title: "agent/antigravity — host-registered Antigravity OAuth provider and Cloud Code Assist stream"
parent: submodule-server-agent
depends-on: [module-contracts]
references: [submodule-server-agent, submodule-server-auth]
tags: [pi, auth]
---

## Responsibility

What ThinkRail owns for the built-in Google Antigravity provider:
- **Host-level provider registration**: registers the built-in `antigravity` subscription provider (`isSubscription: true`) on every fresh `ModelRuntime` generation.
- **PKCE OAuth flow**: Google OAuth 2.0 authentication with PKCE (`S256`), loopback callback server on `127.0.0.1:51121`, graceful fallback to manual URL/code paste, token refresh (`refreshAntigravityToken`), and credentials serialization (`getAntigravityApiKey`).
- **Cloud Code Assist client and project discovery**: endpoint selection with sandbox and production fallbacks, headers, and project ID resolution (`loadCodeAssist` or deterministic SHA1-derived UUID `stableProjectId`).
- **Model catalog & personalized catalog caching**: static seed catalog (`ANTIGRAVITY_MODELS` containing `gemini-4-argon`) serving as pre-login fallback; dynamic model catalog builder (`buildAntigravityCatalog`) returning live chat/agent models from `v1internal:fetchAvailableModels` (restricting to active agent models from `agentModelSorts` when present, skipping auxiliary/exhausted non-agent models) and collapsing effort suffixes (`-low`, `-medium`, `-high`) into base models while recording runtime `model_enum` placeholders and variant routes; `refreshAntigravityModels` aligning with `pi`'s `withPersonalizedCatalog` standard by retaining the last fetched catalog in memory (`lastPersonalizedCatalog`) across offline `allowNetwork: false` refreshes (`provider.status`) and replacing static models rather than merging retired models, falling back to `ANTIGRAVITY_MODELS` only before the first fetch or when credentials are removed.
- **Cloud Code Assist streaming adapter**: `streamAntigravity` translating Pi conversation transcripts and tool declarations into Gemini/Code Assist wire envelopes (`/v1internal:streamGenerateContent?alt=sse`), parsing SSE streams, handling thought signatures, and emitting typed `AssistantMessageEventStream` events with token usage and cost tracking.

## Invariants

1. **Host-registered on every generation.** `registerAntigravityProvider(runtime)` runs during runtime creation before `captureProviderStatus(runtime)` records the pre-opaque `providerStatusIds` allowlist, ensuring `antigravity` is always visible in `provider.status`.
2. **Never fail before `onAuth`.** If the loopback HTTP server cannot bind to port 51121 (e.g., `EADDRINUSE`), the login flow does not abort; it proceeds directly to `callbacks.onAuth` and awaits manual paste input via `callbacks.onManualCodeInput` or `callbacks.onPrompt`.
3. **Compound API key format.** Credentials are serialized as a JSON string `{"token":"...","projectId":"..."}` so the streaming adapter receives both the OAuth bearer token and the resolved project ID.
4. **Near-zero logging and no credential leaks.** Tokens and auth codes are never logged; error diagnostics collapse to generic status messages.
5. **Personalized catalog memory cache.** Once `v1internal:fetchAvailableModels` succeeds, `refreshAntigravityModels` stores the result in memory (`lastPersonalizedCatalog`). Offline refreshes (`allowNetwork: false`, such as `provider.status`) return the cached personalized catalog without making network requests, falling back to `ANTIGRAVITY_MODELS` only before the first fetch or when credentials are removed.

## Files

- `oauth.ts` — `generatePKCE`, `parsePastedCallback`, loopback HTTP callback server lifecycle, Google OAuth token exchange (`TOKEN_URL`), token refresh (`refreshAntigravityToken`), API key extraction (`getAntigravityApiKey`), userinfo email lookup, and `loginAntigravity`. `CLIENT_ID` and `CLIENT_SECRET` are Google's public installed-app OAuth client identifiers shared by all Antigravity CLI installations, assembled from segmented token arrays at runtime (identical in purpose to how `pi-ai` embeds public OAuth client IDs for Claude Code, OpenAI Codex, GitHub Copilot, Kimi CLI, and Grok Build), never a personal or per-user credential.
- `client.ts` — `DEFAULT_ENDPOINT` (`https://daily-cloudcode-pa.googleapis.com`) and fallback endpoints, `antigravityHeaders`, API key packing and parsing (`parseAntigravityApiKey`), deterministic UUID generation (`stableProjectId`), `defaultProjectId`, and Code Assist project discovery (`loadCodeAssist`, `resolveProjectId`).
- `models.ts` — static seed `ANTIGRAVITY_MODELS` catalog (`gemini-4-argon`), `buildAntigravityCatalog` with modular helpers, `getAntigravityModelEnum`, family-based `getThinkingConfig`, dynamic variant routing `getAntigravityRequestModelId`, dynamic/family `getMaxOutputTokens`, dynamic model refresh `refreshAntigravityModels` with `lastPersonalizedCatalog` retention, and `resetAntigravityCatalogForTests`.
- `stream.ts` — `ANTIGRAVITY_API = "antigravity-api"`, `streamAntigravity` implementing `createAssistantMessageEventStream()` and `calculateCost()`, request body builder (`buildRequest`) supplying `labels.model_enum` placeholders when known, message and tool conversion, and SSE stream parser (`streamResponse`).
- `index.ts` — barrel exporting `registerAntigravityProvider(runtime: ModelRuntime)`.

## Boundary

- **Allowed deps:** `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, Node `crypto` / `http` / `url`.
- **Forbidden:** `apps/*`, direct disk writes to user files, spawning child processes or CLIs.
