# Draft-on-Type

Lazy draft-session persistence: a blank new session (+ New / Cmd+T / Command
Palette) is only saved to the backend once the user has typed prompt text.
Autosave is debounced; the session name is derived from the prompt.

**Deliverable:** board ticket `mt_bcd2f1da` — *"Draft-on-type: defer
blank-session save until the user types a prompt"* — holds the full
behavior spec, scope, affected areas, the open question for the specify
stage, and success criteria.

## Agreed behavior (summary)
- **Scope:** blank new-session paths only; meta-ticket and Suggested sessions persist immediately as before.
- **Save trigger:** debounce ~750ms, ≥5 non-whitespace chars, ~5s maxWait, flush on blur/tab-switch/reload/Start. Start/Send always flushes.
- **Name:** ≤15 chars as-is, else first 15 + "…"; live until manually renamed.
- **In-progress text:** persisted and restored into the input on reload.
- **Pre-type:** selectors work locally, no backend calls, placeholder preview; settings-only persists nothing.
- **Repeat + New:** focus the existing blank unsaved tab. Existing empty drafts left alone.
