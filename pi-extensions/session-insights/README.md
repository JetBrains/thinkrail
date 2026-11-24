# @thinkrail/pi-session-insights

A [pi](https://pi.dev) extension that adds an **`/insights`** command: what your past pi sessions say
about how you work — commands that keep failing, skills that are listed but never loaded, files
reworked over and over, cost outliers, subagent spend that pi's own total misses — and a usage and cost
summary. It is computed on your machine from pi's session files, without a model and without the network.

```bash
pi install npm:@thinkrail/pi-session-insights
```

## Usage

```text
/insights                       findings and usage for the sessions started in this folder
/insights --all                 every folder's sessions
/insights --session <id>        one session: turns, errors and how they recovered, context peak, why it cost what it did
/insights --session <id> --html also write that session as a self-contained HTML page
/insights --trace               also write a Chrome trace (Perfetto UI, chrome://tracing, speedscope)
/insights --help
```

A unique prefix of a session id is enough (the report lists the latest sessions with theirs). Without
`--session`, `--html` and `--trace` export the latest session of the scope. On a synthetic history:

```text
Session insights · /work/alpha · 6 sessions · 2026-11-03 – 2026-11-08

Top findings
  ✗ “bun test” fails in 6 of 9 runs (67%, 95% CI 35–88%) in 3 sessions
      “error: expected 3 to equal 4”
  ! 2 skills listed but never loaded: brainstorming, release (≈55 tokens with every request)
  ! 1 session cost over 3× the median $0.40: $7.10 (019a4602); largest 17.7×
  ! Rework: src/app.ts changed 6 times in one session (019a425c)
  · pi's total misses $0.42 of subagent spend in 1 session (pi recorded $0.40 there)
  · You repeated an instruction 3 times in 3 sessions (heuristic)
      “Make the parser tests pass, round 1”

Usage
  Sessions  6 · active ≈1 m · 28 tool calls (6 failed) · 1 subagent run
  Tokens    687k (input 60k, output 4k, cache read 504k, cache write 120k)
  Cost      $8.80 recorded by pi
            + $0.42 subagent spend outside pi's total
  Models    anthropic/claude-test $8.80 (100%)
  Tools     bash 9 (6 failed) · edit 9 · read 9 · Agent 1

Recent sessions (5 of 6)
  019a4602  2026-11-08 10:00     $7.10  4 calls               Migrate the storage layer
  …
```

In the interactive terminal the report appears in the chat (it is not added to the session and not
sent to the model) and progress shows in the footer while a large history is indexed; RPC hosts get it
as a notification; `pi -p "/insights"` writes it to stderr, since pi keeps stdout for its own output.

## What the numbers mean

- **Tokens and cost are pi's recorded totals** — every spend-bearing entry, as `/session` counts them —
  never price × tokens. A model that records $0 shows its tokens and "not recorded".
- **Marks:** `≈` an estimate (active time, a skill list's tokens), `≥` a lower bound (some calls record
  no cost), `?` a figure pi did not record or that could not be measured.
- **Subagent spend outside pi's total** comes from the subagents' own transcripts (pi-subagents keeps
  them under `<agentDir>/delegation/default/<session>/`) minus what the parent already mirrored.
- **Findings are fixed rules**, not an LLM's opinion: a command with ≥ 3 failures and ≥ 8% of its runs
  failing, in ≥ 2 sessions (with a 95% Wilson interval), skills listed but never loaded, ≥ 3 identical
  calls in a row, oversized results, context-limit hits, sessions over 3× the median cost, a file changed
  ≥ 5 times in one session, and a few labelled heuristics (retries, cache-miss causes, repeated
  instructions, "tests pass" without a test run). Nothing is applied for you.

## Privacy

Local only. The command reads pi's session files and writes nothing back to them; it makes no model
call, no network request and sends no telemetry. It keeps a disposable summary cache (sizes, counts and
session titles — no message text) in `<agentDir>/session-insights/cache/`, and exports go to
`<agentDir>/session-insights/` (`<agentDir>` is `PI_CODING_AGENT_DIR`, else `~/.pi/agent`). Text it shows
or exports is masked on a best-effort basis (your home folder becomes `~`; API keys, tokens, passwords,
credentials in URLs, private keys and emails become `[redacted]`), and an export is refused when the
check after masking still finds such a pattern. Review an export before you share it.

## As a library

The package is also the analysis engine behind ThinkRail's Session insights panel:

- `@thinkrail/pi-session-insights` — the engine (discovery, the incremental index, per-session
  analyses, statistics across sessions, exports) behind injected locators;
- `@thinkrail/pi-session-insights/core` — its result types and constants, with no runtime imports;
- `@thinkrail/pi-session-insights/extension` — `createSessionInsightsExtension({ agentDir, locations,
  command })` for a host that keeps sessions elsewhere.

## Requirements

pi ≥ the version listed under `devDependencies` in this package's `package.json` (pi's SDK is a peer
dependency supplied by your pi install). Works under Node ≥ 22.19 (vanilla pi) and Bun.

## License

Apache-2.0 — part of [ThinkRail](https://thinkrail.ai/?utm_source=pi-package&utm_medium=referral&utm_campaign=pi-session-insights&utm_content=readme).
