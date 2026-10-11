# A chatless work surface for Plan's Now block — RFC (draft)

Status: draft · Owner: TBD · Decision needed before coding.

User signal (verbatim): «Очень сложно все еще в разделе Now управлять чатом и им не пользоваться
давай изучим есть ли уже такие решения в интернете новые концепты - ведь люди чат не читают».

Short form: the Now block in the Plan rail still forces the user through chat primitives — read the
agent's last message, type a reply — to steer. Users say they don't want to read chat; they want to
control the agent and see progress without transcript scrolling.

This RFC is independent from `plan-v2-rfc.md` (markdown-doc mental model) and
`plan-as-side-rail-rfc.md` (placement). It is about the **interaction model inside the Now block** —
what replaces, or augments, the chat-shaped surface for day-to-day control. All three RFCs can land
independently; they compose, they don't block each other.

## What the industry just did (2026 scout)

Direction one sentence: **chat UIs are being retired as the primary agent surface** and replaced with
plan-first + artifact-first + work-queue surfaces where chat is a side-channel for clarification only.

Concrete tools, concrete moves:

- **Devin** — **Progress tab** collapses Shell + IDE + Browser into one view. **Session Insights**
  analyses the whole session after the fact and flags "approach changed here", "incorrect codebase
  assumption". **Devin Review** groups diff + explanation under Changes / Bugs / Discussion tabs —
  no scrolling of the transcript to find them.
- **Cursor Composer** — multi-file inline diffs, dedicated **Review → Find Issues** pass. Known gap
  (user feedback): "diffs appear incrementally, can't see all at once; Review panel can't fullscreen".
- **Lovable** — explicit **three modes** (Chat / Plan / Build) with one shared context. Mode is the
  verb; chat is the fallback.
- **Zed** — **"New From Summary"** starts a fresh agent thread seeded with the current state —
  explicit move from transcript to artifact.
- **Google Antigravity / Cursor 3 / GitHub Copilot** — convergence Oct 2025 – May 2026 on
  **editor + manager surface separation** (edit vs dispatch/monitor are different places).

Design-literature synthesis (Zylos, Setproduct, Agent Patterns, Limecloud, ICMD, auxfirst): a 300-line
transcript with a blinking cursor is unreadable when an agent runs 11 minutes unattended. The patterns
that cluster: **plan-first surfaces · editor–manager separation · artifact workspace (chat-left /
output-right) · work queue over chat · progress summaries & checkpoints**. The ICMD headline fits
exactly: *"Kill the Chatbot: Your Product's Next UI Is a Verified Work Queue."*

ThinkRail is already partway there: Plan is becoming the rail surface, `plan.summary` is PR-ready,
step-level `summary` + `verification` are visible inline. The Now block is the last chat-shaped
survivor inside Plan.

## The four concepts (full comparison in-chat)

Each concept targets one leg of the complaint:

| | Fixes "can't manage" | Fixes "can't see progress" | Cost | Reversible |
|---|---|---|---|---|
| **A. Action Log** (lentia tool-calls instead of `lastAgentText`) | — | ✓ | S | ✓ |
| **B. Step-level live view** (live row under each in-progress step) | — | ✓✓ | M (needs tool-call ↔ step mapping) | partial |
| **C. Steer-mode composer with chips** | ✓✓ | — | S | ✓ |
| **D. Interactive plan edit** (user edits the plan file) | ✓✓✓ | — | L (new RPC + conflict policy) | with migration |

A and B are mutually exclusive (both replace what the live slot shows). C and D compose: C is the
near-term relief, D is the long-term direction (and lands naturally on top of Plan v2).

## Recommendation (phased)

**Phase 1 — Steer-mode composer with chips (concept C).**

What ships:
- The Now-block composer gets a row of context-aware chips above (or beside) the textarea: a stable
  core set (`Retry`, `Skip step`, `Continue`, `Add tests`, `Undo last change`) plus 1–2 chips derived
  from the agent's current activity ("the last tool was `edit auth.ts` → chip `Explain the change`").
- Chip click dispatches `session.steer` with a canonical phrasing (one place to tune per locale /
  skill). The user types nothing to steer in 90% of cases.
- The textarea becomes secondary — collapsed to a one-line "…" expander. Free text is still there
  for the uncommon case.
- No backend contract change — chip actions are canned `steer` prompts. Chips are a selector over
  known agent capabilities; a feature-detect on the session's `protocolVersion` hides chips the host
  doesn't support.

Why first: fits the exact user complaint ("сложно управлять"), one coherent commit, reversible — if
chip-mode doesn't resonate we can hide chips with a feature flag and the plain textarea is still
there. Estimated 2–3 days.

**Phase 2 — Action Log (concept A).**

What ships:
- `PlanSessionLive` grows an `agentActivity` view: a bounded list of the last ~N tool/edit/question
  rows for the active session, one row per event, with a short canonical renderer (icon + verb +
  target + duration). Pending ask still takes precedence; `lastAgentText` moves behind a disclosure
  ("Agent message · click to read") so the Now block stops being prose-first.
- Click on a row jumps to the full tool-result card in the chat tab — chat becomes the "why" surface,
  rail becomes the "what" surface. Users who don't want to read chat never have to.
- Data already in `runtime.turns` / `toolResults` / `askStates`. The renderer is additive; the
  existing message block becomes an opt-in.

Why second: closes the other leg ("не читают чат") without touching contracts; validates the "chat
as side channel for clarification" direction cheaply. Estimated 3–5 days.

**Phase 3 — Interactive plan edit (concept D) — only when Plan v2 is approved.**

What ships (as part of Plan v2, not before):
- The user can edit the plan markdown directly: strike a step, rename a title, insert a step, mark
  done. Edits dispatch via new `todos.editTitle` / `todos.reorder` / `todos.setStatus` RPCs
  (wrappers over existing `TodoStore` methods — `promote`, `update`, `remove` already there; only
  `reorder` is new).
- Agent reads user edits as instructions through a small skill addition ("when the user strikes a
  step, treat it as `skip`; when the user adds a step, pick it up next after the current one").
- Chat becomes genuinely optional: the plan file is the dialogue surface.

Why last and conditional: it's the full "kill the chatbot" move, worth doing only on top of Plan v2's
markdown-doc shape. Doing it before v2 means building the editor twice. Estimated 1–2 weeks on top of
v2.

**B (step-level live view) is deliberately not phased in.** It's elegant but it needs a reliable
`tool-call → step id` association that doesn't exist in the agent protocol today and would require
either host-side heuristics (fragile) or a protocol change (expensive). Keep it as a design option
for a hypothetical v3.

## Open questions

**Q1. Chip vocabulary and localisation.** The core chip set is in English today. Do we:
- (a) ship English only now, add i18n later;
- (b) tie chips to a per-skill vocabulary file so a skill owner can override labels + canonical
      prompts;
- (c) use `promptSnippet`-style registration so chip provenance is auditable (a chip is "from skill
      X").
→ **Recommendation:** b + c. Chips live in a per-skill (or per-tool) registry; the Plan Now block
  just renders what the active session's skills contributed. Fallback to a hardcoded minimum set.

**Q2. "Smart" chips — how smart?** A dumb chip is a canned prompt. A smart chip reads the agent's
last activity and offers a context-matched phrase. Smart chips are powerful but hallucinatable.
→ **Recommendation:** start with dumb chips (no inference), add one explicit smart chip that is a
  function of the last tool kind only (`edit → "Explain the edit"`, `shell → "Why that command?"`),
  no NLP.

**Q3. Should the chat composer in the chat tab adopt chips too?** Possibly, but it changes a lot of
established flows. Scope this RFC to the Plan Now block only; chat composer stays as is.
→ **Recommendation:** out of scope; separate ask when (and if) users request it.

**Q4. Where do chip prompts land in the chat transcript?** Options: (a) rendered as the user turn
verbatim ("`Retry`" or "Retry the previous step with X"), (b) rendered as a synthetic system marker
("User steered: retry"). (a) matches today's `session.steer` behavior and is auditable.
→ **Recommendation:** a. One canonical prompt per chip, visible in the transcript, no new render
  kind.

**Q5. Action Log density — how many rows?** A 10-second agent cycle can produce 30+ tool calls.
→ **Recommendation:** show the last 5 by default with a "show N more" expander; cap at 50 to keep
  the rail scrollable; roll up consecutive same-kind rows ("read 7 files" instead of 7 lines).

**Q6. Does Phase 2 (Action Log) replace `plan-agent-message` or coexist?** The current block is one
of the quick wins (always-on `lastAgentText`), tied to a direct user complaint.
→ **Recommendation:** coexist, but demote. `lastAgentText` collapses to one line with a chevron;
  the action log takes the main slot. Users who want the prose can expand.

## Cost (summary)

| Phase | Scope | Days (one eng) | Risk |
|---|---|---|---|
| 1 | Steer-mode composer + chips (per-skill registry) | 2–3 | Low |
| 2 | Action Log + demote lastAgentText | 3–5 | Medium (density/perf at 50 rows) |
| 3 | Interactive plan edit (needs Plan v2) | +7–10 on top of v2 | High (conflict policy) |

Total if we commit to all three: ~2–3 weeks sequential, less if phased with Plan v2 in parallel.

## Decision needed

- Approve Phase 1 as the next land after `todo-plan-polish`?
- Confirm Phase 2 as the one after that (independent of Plan v2)?
- Park Phase 3 under Plan v2 explicitly (so it doesn't get planned twice)?
- Chip-vocabulary direction (Q1): per-skill registry — ok?

Not blocking: the current Now block is fully functional and the quick wins from `todo-plan-polish`
address the acute pains. This RFC is about the next level.

## See also

- `apps/web/src/panels/plan-v2-rfc.md` — mental model (markdown-doc). Phase 3 is a dependency.
- `apps/web/src/panels/plan-as-side-rail-rfc.md` — placement (now shipped).
- `apps/web/src/chat/useChatTodos.ts` — current `PlanSessionLive` wiring (`lastAgentText`,
  `pendingAsk`).
- `apps/web/src/panels/PlanPane.tsx` — `PlanComposer`, `SessionBlock`.

### Research sources (scout step)

**Primary tool docs:**
- Devin — <https://docs.devin.ai/work-with-devin/devin-session-tools>, <https://docs.devin.ai/product-guides/session-insights>
- Cursor — <https://cursor.com/help/ai-features/agent>, <https://cursor.com/blog/agent-best-practices>
- Lovable — <https://docs.lovable.dev/features/agent-mode>
- Zed — <https://zed.dev/docs/ai/agent-panel>

**Design-pattern references:**
- <https://zylos.ai/research/2026-05-28-agentic-ux-frontend-design-patterns-ai-agents/>
- <https://www.setproduct.com/blog/ai-agent-ui-design-patterns>
- <https://agentpatterns.ai/patterns/agent-design/editor-manager-surface-separation/>
- <https://limecloud.github.io/agentui/en/surfaces/artifact-canvas>
- <https://icmd.app/article/kill-the-chatbot-your-product-s-next-ui-is-a-verified-work-queue-1784317334400>
- <https://auxfirst.com/agent-first-design.html>
