---
id: module-browser-e2e
type: module-design
status: active
title: Browser E2E harness
parent: architecture
depends-on: [module-server, module-web, module-cli, module-desktop, module-shared]
references: [module-ci-release]
tags: [testing, playwright, e2e]
---

## Responsibility

The real-browser system gate for ThinkRail's host/UI integration: build the shipped web client, boot an
isolated host, seed real git and persistence fixtures, drive Chromium through the wire, and clean up every
machine-global resource it used. The default suite excludes provider-backed `@agent` tests; those remain
explicit, authenticated, on-demand runs.

## Execution model

`bun run e2e` is the complete no-agent gate. It builds the web bundle once and runs machine-adaptive,
process-level Playwright shards. A shard owns one host and one Playwright worker; serial execution inside
that lane preserves the suite's destructive reset semantics, while lane-qualified state and ports make
lanes independent. Playwright splits individual tests across lanes and the parent runner merges their blob
reports into one normal result. It also merges shard failure ids into Playwright's root last-run file,
so `--last-failed` remains a valid serial repair loop. No-agent coverage is identical whether the count
is one or many.

The automatic count is half the available CPU parallelism, clamped to 1–8. Developers may explicitly
select 1–16 lanes; `e2e:serial` is the stable debugging fallback. A focused invocation carrying Playwright
arguments defaults to one lane unless its shard count is explicit, so an iteration on one spec stays cheap.
Every public browser E2E runner owns one process-lifetime idle-sleep assertion on macOS before setup or
build work begins; source, agent, full, binary, and desktop modes all receive it. The assertion uses the
system `caffeinate` executable with idle-system-sleep scope and the owning runner pid, so display sleep stays
available and abrupt owner exit releases it. A private inherited owner marker makes composed full-run phases
reuse the parent's assertion rather than multiplying helper processes. Other operating systems are a no-op,
and a macOS host that cannot establish the assertion fails before spending test time.
Direct no-agent use of the Playwright config remains self-contained and builds the web app when the shard
runner has not already done so. Real-Central execution enters through the public `e2e:agent` or `e2e:full`
runner; direct Central-mode test execution is rejected (while `--list` remains available), because the public
runner must own the build before giving Playwright its credential-stripped environment. Standalone agent
runs always build outside `--list`; ambient skip-build cannot suppress that phase. Only the full runner's
post-build internal readiness marker may select the already-built agent plan. The plan then adds both
skip-build and a dedicated Central-runner authorization marker to the Playwright environment; Central
execution requires both, so skip-build alone cannot bypass the public runner. A focused `e2e:full` invocation
lists the selection independently in no-agent and agent mode, runs only phases with selected tests, and fails
when neither mode selected anything; the argument-free full gate and its two-phase `--list` behavior stay
unchanged. The no-agent, agent, and full runners own the trees they launch. When full composes a phase runner,
an internal parent-owner marker leaves full as the only signal manager; standalone no-agent and agent runners
retain ownership. On POSIX, the owner snapshots every descendant PID with its safe non-runner process group,
forwards SIGINT/SIGTERM to each tracked group exactly once and individually only to PIDs without such a group,
then force-kills those same non-overlapping targets after a bounded grace even if the root exited. Windows
first snapshots and retains
descendant PIDs through PowerShell's `Get-CimInstance Win32_Process`, gracefully falls back when unavailable,
and uses `taskkill /T` before a root fallback; force targets every retained PID with `taskkill /T /F`. This
guarantee does not extend to the separate binary or desktop artifact runners. Tests for primary-modifier
chords read the page's browser-reported platform through one fixture helper and inject Meta on Apple or
Control elsewhere; hard-coding the runner host's modifier would exercise the wrong product branch under
browser/platform emulation.

Provider-backed browser tests (`e2e:agent`) use a dedicated serial real-Central mode; the separate
headless workflow suite keeps its local PI-auth mode. Concurrent provider turns would alter rate limits,
cost, and determinism, so neither is sharded. The agent runner builds the web artifact under the caller's
normal environment, then removes PI's complete ambient provider/cloud credential environment surface before
starting Playwright or any host. The hosts also receive the same complete hermetic `PATH` as the default
suite. This split is load-bearing: build
tooling may need developer-installed executables and caller environment, while exact-model preflight must
prove Central without an API key, token, Google ADC/project/location, or AWS profile/key/token/container/
web-identity/config source making another provider available. A drift canary derives every uppercase
environment literal from pi-ai's pinned credential-discovery distribution and requires it in the denylist;
defensive cloud-source extras remain even when that distribution does not currently name them. No host may
discover a real `central`, `pi`, or editor executable. The compiled-binary and
packaged-desktop suites remain distinct artifact gates. Each has an unsharded, non-overlapping namespace;
any artifact run and `e2e:serial` still run sequentially in the same worktree. A future launcher or
deployment adds another host adapter for this same suite, never copied feature specs; shared behavior is
therefore proven through every composition root.

## Desktop-backed mode

`bun run e2e:desktop` runs the complete no-agent suite against the host embedded in the packaged
Electrobun process. A test-only environment seam keeps Electrobun's required native window hidden on a
neutral local page and publishes the dynamic host origin through a ready file. Playwright is therefore the
only hydrated application client: the native webview cannot take over exclusive terminal attachment or
write shared placement while the test page is asserting it. The desktop adapter writes the control file
only after Playwright finishes, then requires normal graceful application exit.

This is separate from `smoke:desktop`: native smoke loads the actual packaged ThinkRail UI in the system
webview, requires DOM-ready plus host health, and quits through the real Electrobun lifecycle. Linux runs
that smoke under Xvfb with software rendering enabled only in the test environment. The split proves both
the native-window path and broad browser behavior without introducing two competing clients.

JetBrains Central coverage uses a stateful, independently authored fake executable implementing only the
argv/exit/postcondition surface ThinkRail invokes (`--version`, `status`, `quota --json`, `add pi`,
`remove pi`, `login`, `update --install`). Its control file holds **space-separated tokens**, because the version a probe reports,
whether credentials exist, and how an action fails are independent facts about a host: a single-valued control
made real combinations unrepresentable, and a state that cannot be reached is a failure mode nothing asserts
(`update --install` refusing while the host is below the minimum needs both at once). It
materializes a test-owned synthetic PI extension written solely against PI's public API; no Central artifact,
source fragment, output string, route, constant, binary, or secret is copied. Browser scenarios cover
absent/outdated/malformed probes plus an above-minimum version staying ready, update, sign-in/retry, native
add/remove, synchronous-action
serialization, watched external add/change/remove, successful current-generation cutover for new chats, old
live-chat coexistence after Disconnect, and boot/runtime retention after a closed synthetic-extension load
failure. Unit coverage owns action single-flight, watcher debounce/coalescing, stale-candidate rejection, boot
with and without the opaque extension, and exact-model no-fallback for new or reattached chats after Central
is removed. There is no legacy migration, busy-turn drain, reattachment of live chats, compensation,
affected-chat blocking, or recovery seal to test. Sentinel values in synthetic child output, extension
diagnostics, and provider routing fields
are asserted absent from the closed results and rendered settings surface; structural DTO allowlists and
generic host mapping keep those classes out of WS frames, analytics, logs, and persistence.

Quota coverage adds test-owned structured recurring values and closed failure tokens—never real Central
output. It proves the top-bar readout appears only for healthy + enabled Central, polls at the synchronized
whole-second interval only while visible, deduplicates host reads, retains stale values with Retry, hides on
disable/disconnect, and degrades at mobile width; the Providers card pins default/on-off/interval validation
and persistence. The reviewed-argv assertion rejects any presentation-text quota fallback, while sentinels in
ignored quota fields prove account/plan/used/top-up/refill/diagnostics never cross the wire or render.

The Central specs share one fixture module for panel navigation, lifecycle-state waits, the argv log, and
the out-of-band host mutations — installing/uninstalling the fake by moving it in and out of the lane's PATH
directory, and running it directly as a user's own shell would. A host-side invocation deliberately inherits
none of the host's PATH, so a spec can never reach a real `central`. Because that same log records both
sides, a spec that injects a host invocation asserts *counts* rather than mere presence — that is what
distinguishes "the app reacted to an external change" from "the app re-ran the action".

A second spec covers the lifecycle a user actually walks, one test per situation: Central absent, installed
but signed out, uninstalled while connected, PI disconnected in-app and again on the host, and a host-side
logout. Its load-bearing assertions are the ones a state name cannot express — that an uninstall withdraws
Central's models from new chats while the global artifact survives, so reinstalling repairs by re-probing
instead of a second `add pi`; that a signed-out host is offered Sign in and **no Connect at all**, with the
ready claim replaced rather than annotated; and that a logout leaves the connection intact underneath while the
card renders one state only: the signed-out line without the contradicting "Connected" one, a single Sign in
with Disconnect withheld as well, and both restored once the user signs back in. The reactive guidance keeps
its own spec, driven by the case the probe cannot see: credentials present, `add pi` refused anyway.

The fake models the `Auth` row's shape only — a styled indicator, a padded label, a styled value — and prints
a sentinel line beside it that must never surface in the UI, since the real command prints the user's licence
and server. The cached verdict shapes the suite twice, and both accommodations are deliberately the same
thing a *user* does rather than a reach into the host. A spec that flips the host's credential state waits
the TTL out and refreshes, so the assertion belongs to the card's copy and not to the cache. And because
Connect is withheld while the verdict says signed out, every connect-driven scenario refreshes until the
button appears instead of assuming it — a verdict left behind by an earlier scenario would otherwise hide it,
exactly as it would for someone returning to the panel inside the window. Each state is also captured as a
review PNG under `e2e/screenshots/<group>/`
(gitignored, stable path, one element shot per state, retina). Screenshots are evidence, never the
assertion — a state that only a picture would catch is a missing `data-testid`. Identical files across
scenarios are a finding, not a defect: they are how the suite shows two distinct host situations rendering
one indistinguishable card.

The real-Central agent mode is explicit and read-only. Its setup takes the already-authorized global Central
extension as an opaque source and stages one permission-restricted copy under the lane's isolated HOME; the
host still resolves only the test-owned Central executable, and that executable refuses every mutating
action in this mode. The isolated PI agent directory receives `settings.json` only — never the developer's
`auth.json` or `models.json` — so Central is the sole provider source and unrelated local models cannot enter
the picker. Setup waits for the watched runtime generation to report configured over the public wire, then
requires `model.default` to equal the exact `THINKRAIL_E2E_MODEL` pair (the deterministic suite default is
used when the variable is absent). A missing artifact, failed generation, or unavailable exact pair aborts
before any provider turn; PI's ordinary first-available fallback is never accepted as test configuration.
The same copy and hermetic environment seed the private restart host.

**Workspace activity** (`workspace-activity.spec.ts`) covers the Projects rail's agent-state glyphs without
an agent, and is the reason the host's `failed`/`waiting` derivations read the transcript: a seeded fixture
transcript (an assistant with `stopReason: "error"`, or an `ask_user_question` call plus its `ack` tool
result) becomes real activity, so the whole chain — host derivation, `session.activity` push, store fold,
rollup, render — runs for real on the no-agent lane. It asserts the row's `data-activity` and the glyph's
`aria-label` (never the tooltip, which needs hover), the rollup breakdown when one workspace holds both
states, and the collapsed-project rollup.

Two entry paths are covered on purpose. Opening the chat attaches the session and exercises the **live**
path; a **reload after seeding** exercises the **disk** path — the snapshot union — by asserting the glyph
appears while the workspace is never activated and no chat tab exists, which is the reviewer scenario a
host restart produces. Note that **seeding must happen after `openFixtureProject`**: `openAppFresh` calls
`resetState`, which deletes the isolated agent dir's `sessions` tree, so anything seeded earlier is wiped.

Workbench scenarios exercise the normalized frontend-local frame rather than only the pure model: frame
geometry/tool placement survives workspace switches while resource tabs and attention differ; closing a final
resource retains its empty group; explicit group removal rehomes hidden-workspace resources; reload restores
endpoint/surface-qualified local state; a tab initialized with cloned session storage remints its live surface
id and both tabs retain independent frames through reload; a simultaneous second page neither adopts peer
file/terminal/chat placement nor misses the peer-created chat's history-only domain event; custom preset CRUD synchronizes, the local default drives explicit frame Reset, and Apply affects only its page. A pristine or invalid local document starts directly from Balanced, and the suite asserts that no current-layout request exists.

Bottom-workbench coverage retains all four alignments with real side-stack ownership of excluded lower
corners, live alignment during side resizing and narrow-width compression, pointer/keyboard persistence of
only the separator-owned side ratio, independent height/group resizing, 27 px folding with `Ctrl+F6` restore
focus, modal-aware visibility chords, PTY continuity while hidden, and process-free default-terminal
reservation. Terminal creation now exercises the host pending-marker handshake plus independent local
placement, not a layout revision or peer geometry synchronization.

## Isolation contract

Every concurrent lane derives a distinct data dir, HOME, pi-agent dir, fixture repository, binary cache,
desktop cache/state plus ready/control files, Playwright transform cache, restart artifacts,
picker/editor/provider control files, host/restart/binary/desktop ports, and Central fixture artifacts. The
transform cache is lane-local because Playwright's shared cache assumes a single runner process; sharing it
lets a cold shard consume another shard's partially written transform. The lane's fake executable directory
lives under `.bun/bin`: this intentionally marks the injected, hermetic host `PATH` as complete to
`resolveShellEnv()`, preventing login-shell repair from replacing the Central/editor stubs with
developer-machine executables. Folder selection comes from one picker control file across the source,
binary, and desktop hosts: plain content returns a path and an `error:<message>` directive forces a
platform-independent failure. The source host also receives empty `DISPLAY` and `WAYLAND_DISPLAY`, so a
broken control cannot reach a developer's Linux display; native Linux preflight stays unit-covered. Port
allocation remains stable and collision-safe across
worktrees: the registry claim distinguishes
a lane's logical key while checking staleness against the real worktree path. Legacy plain-path claims are
still valid.

Different worktrees may run concurrently. Two complete E2E invocations in one worktree remain sequential;
the lane ids are deliberately stable across runs so interrupted state is reclaimed rather than leaked.
No path may fall back to `~/.thinkrail`, the developer's HOME/config trees, or the real pi agent dir. The
explicit agent-mode setup is the narrow exception: it reads one known global Central artifact into the
lane-owned copy, never runs from or writes to the source, and removes the copy on setup failure or teardown.
A sandboxed home is handed to every host as **both `HOME` and `USERPROFILE`**: `homedir()` — pi's own home
resolution — reads `USERPROFILE` on Windows and ignores `HOME`, so `HOME` alone would silently leak a
Windows lane into the real profile (see `module-shared`).

## Boundary

- **Owns:** browser scenarios and fixtures under `e2e/`, their Playwright configuration/runner entrypoints,
  isolation and port-allocation rules, report orchestration, and the public `e2e*` package commands.
  `e2e/fixtures/git.ts` is the one place specs shell out to `git` (`git`, `gitQuiet`, `gitText`, `gitAs`,
  `commitFile`); `gitAs`/`commitFile` pin a throwaway e2e identity so a seeded commit's authorship never
  depends on the developer machine's real git config.
- **Consumes:** the built web artifact, the host's public boot/wire behavior, sanctioned server test-fixture
  exports, CLI binary, packaged desktop adapter, shared retrying teardown helper, git, Chromium, and
  Playwright.
- **Forbidden:** fake application backends, provider fakes in production boot paths, browser imports into
  product modules, default/no-agent tests depending on developer state, agent tests reading anything beyond
  the explicitly authorized Central artifact, or parallel workers sharing one mutable host.

## Verification policy

During iteration, run the affected specs and use Playwright's last-failed mode. Flake repairs replace
irrelevant expensive setup with equivalent fixture state and wait for observable readiness; blanket retries,
arbitrary sleeps, and assertion weakening are not synchronization policy. Live-provider completion waits on
the session's streaming state after response evidence appears; the optional rendered `Done` row is not a
terminal-state contract. Scenarios whose subject is a client-side send transformation assert the exact
outgoing `session.prompt` frame rather than treating a
mounted optimistic transcript row as delivery evidence: a fast provider rejection can add a taller error,
scroll to the latest row, and legitimately virtualize the preceding user row. Chat-order coverage seeds
multi-round transcripts and asserts both latest edges, their physical **Latest** destinations, host-qualified
browser-local persistence, and cross-browser isolation without involving a provider. Hydrated-history
coverage seeds one canonical giant Markdown block and drives real coarse wheel input so initial virtual
geometry cannot clamp before the row mounts. Questionnaire paging uses a canonical persisted tool-call/ack
fixture to pin tall-page reveal, fresh-chat restored-page reveal, visible review focus, and coarse-pointer
focus without provider variability; desktop package tests separately pin the stable
backend-profile/window adapter required across dynamic-port restarts. Streaming-band coverage remains
`@agent` because only Pi's real row growth exercises that lifecycle. Before handoff, every app-affecting
change runs the complete `bun run e2e` no-agent gate. Artifact-only regressions remain covered by
`e2e:binary`, `e2e:desktop`, and their shared host probe: a synthetic opaque external extension loads with
no `pi` executable on `PATH` for default and custom `PI_CODING_AGENT_DIR`; desktop additionally proves its
staged `.ts` PI runtime and physical resources. Real Central acceptance remains explicitly authorized and
isolated: the dedicated `@agent` suite stages the opaque artifact, validates the exact model, and proves a
real turn rather than accepting another provider or a fake agent.
