---
id: pi-compatibility
type: architecture-design
status: draft
title: Pi compatibility — host adaptations and upgrade removal gates
parent: architecture
references: [submodule-server-agent, submodule-server-agent-mcp, submodule-server-history, submodule-server-templates, module-cli, module-desktop, submodule-web-chat, module-pi-subagents, module-pi-background-commands]
tags: [pi, compatibility]
---

## Responsibility

The upgrade checklist for host code that compensates for a missing pi API, a pi defect, or a
packaging constraint. Pi remains the engine and state owner. Module specs own detailed rationale;
this index records what an upgrade must re-check and what would let us delete the adaptation.
The installed version comes only from the root dependency catalog, not a second pin in this file.

## Last re-check

The compaction output-cap upgrade ([upstream #11036](https://github.com/earendil-works/pi/pull/11036))
was checked against the installed catalog version. **No removal gate is satisfied.**

- MCP loader/writers remain private; management/status still use commands, notifications and logs.
  `openUrl` remains the public sign-in URL seam. The one parity change is single-leading-BOM acceptance,
  now shared by the host loader, writers and raw-entry occupancy/fingerprint reads. Config and host
  tests cover both scopes, approved overrides, malformed occupied names and refused-write preservation.
- `AgentSession.dispose()` still does not emit extension shutdown; reload dispatch is sequential,
  and MCP clears its server list before awaiting closure. Keep ordered cleanup and late-start admission.
  Codemode still needs a worker/WASM artifact surface we do not package. Raw `structuredContent` is
  still ephemeral, not a bounded durable transcript presentation.
- Delivered queue removal and `clearQueue()` remain text-only. SDK creation still does not initialize
  a headless terminal theme. Extension loading still needs Jiti/virtual-module adaptation in artifacts,
  static OAuth/Bedrock registration and the image-resize override. Artifact probes also exercise a
  value import from `pi-ai/models` through the external extension loader.
- Public trust detection does not replace resource-kind discovery/exclusion reloads; session discovery
  and prompt-template APIs still do not cover the host's read/edit surfaces. Keep their parity tests.
- Pi now sizes history, turn-prefix and branch summaries without reserve-derived output caps. Reasoning
  inheritance and rejection of incomplete `length` summaries remain. One public-compaction canary checks
  turn-prefix answer room across different reserves without pinning provider option policy; lifecycle
  tests retain cancellation and incomplete-summary rejection coverage.
  Restored truncated-call recovery now omits the paired tool result too, but does not replace
  `sessionRepair`'s host-restart and questionnaire repair. No host summarizer, effort-default change,
  reserve tuning, wire migration or session migration is introduced.
- Pi 1.3's resumed tool-loadout restore adds one host seam, the registry-tool reconcile at attach below.
- The bundled chat catalogue changes from 1,554 to 1,599 provider/model pairs: 71 removed and 116 added.
  Removed pairs include `openai-codex/gpt-5.5` and `openai-codex/gpt-5.3-codex-spark`;
  `openai/gpt-5.5` remains. This is a bundled-catalogue change, not a claim that providers retired those
  APIs; stored, refreshed and custom catalogues can differ. Release notes must advise users to check
  their default and restored-chat model before continuing. Unavailable defaults/resumed models follow
  the existing, different host/Pi selection rules in [[submodule-server-agent]]; the host still does not
  surface Pi's `modelFallbackMessage`. This upgrade adds no fallback or warning UI.
- Since Pi 1.3, `kimi-coding` uses OpenAI Chat Completions at
  `https://api.kimi.com/coding/v1`. Users with custom `models.json` base URL overrides must include
  `/v1`; the host does not rewrite those overrides. Include this migration notice in release notes.

## Upgrade contract

Every pi upgrade checks each entry against the **installed package's exports and implementation**,
not only release notes or an upstream issue's status. The upgrade's verification summary names the
adaptations removed, retained with evidence, or changed, and the affected tests run. A new workaround
adds an entry here and rationale in its owning spec; its removal deletes both the workaround and its
entry. A parity failure is evidence of drift, not permission to weaken the test.

A public SDK replacement must preserve session isolation, cancellation, project trust, durable
transcripts, and compiled/desktop behavior before the host implementation is removed. Importing a
private dist path in production is not a replacement; such imports remain confined to parity tests.

## MCP adaptations

### Configuration loader and writers

**Owner:** [[submodule-server-agent-mcp]], `agent/mcp/config.ts` and `writers.ts`.
Pi's public `loadConfig` hook replaces its loader wholesale; its loader, validator and writers are
not public exports. The host ports their file semantics to apply project policy and perform safe
multi-client writes. **Removal gate:** a public loader/validator/writer surface preserving entry
provenance and allowing admission before project overrides merge. Verify the port against the
installed `core/mcp-servers` and `extensions/mcp/config`; run `agent/mcp/config.test.ts` and
`host/mcp.test.ts`. Host containment, stale-write checks and private policy remain host obligations.

### Runtime status, management and sign-in outcomes

**Owner:** [[submodule-server-agent]], `mcpSessions.ts` / `mcpSignIn.ts`, and
[[submodule-server-agent-mcp]], `status.ts` / `log.ts`.
Pi exposes management through `/mcp` and notifications rather than a typed controller. The host
captures those commands, parses status and outcome text, reads pi's log format, and uses an isolated
pi session for Settings probes. OAuth and credentials stay in pi; the authorization URL is available
through pi's public `openUrl` callback and needs no text parser. **Removal gate:** a public per-session
status read/subscription and cancellable management/auth API, plus structured diagnostics for log
reads. Run `mcpEngine.test.ts`, `mcpSignIn.test.ts`, and the MCP status/log/redaction tests; verify both
modern status pushes and legacy notification redaction when pi's wording changes.

### Ordered engine shutdown and reload admission

**Owner:** [[submodule-server-agent]], session lifecycle, and [[submodule-server-agent-mcp]], `engine.ts`.
`AgentSession.dispose()` does not emit shutdown, and pi's sequential extension shutdown can be held
by an unrelated handler. The host captures the builtin MCP shutdown handler and starts it before
ordinary teardown/reload, retaining a bounded host quit path. Captured and runner-emitted shutdown
share one per-load cleanup promise; reload awaits actual cleanup before replacement admission. Pi
clears its server list before awaiting closure, so idempotence is insufficient to guarantee
completion ordering. The host also guards the actual MCP startup/change callbacks after closure:
`beforeSessionStart` precedes the entire async dispatch and cannot alone prevent late startup.
**Removal gate:** a public lifecycle that closes MCP independently of unrelated handlers, joins the
same actual cleanup on repeated shutdown, admits replacements only after cleanup completes, and
prevents startup even when an earlier handler resumes after disposal. Re-check completion ordering
and `AgentSession.reload` hooks, not just idempotence; run `sessionShutdown.test.ts`, `reloadGate.test.ts`,
and MCP delete/reload/process-lifetime regressions, including a stubborn old PID and a startup dispatch
paused through closure with async `resources_discover`.
`AgentSessionRuntime.dispose()` alone is not evidence that these host obligations disappeared.

### Exposure while codemode is not packaged

**Owner:** [[submodule-server-agent-mcp]], `normalizeExposureForHost` and tool-search activation.
File-configured `codemode` exposure becomes `deferred`; registered servers stay reachable through
`tool_search`. **Removal gate:** ship pi's codemode worker/WASM across CLI and desktop, then preserve
native exposure without normalization. Run config/exposure tests and the shared artifact probes;
public factory availability alone does not establish packaging support.

### Durable presentation details

**Owner:** [[submodule-server-agent-mcp]], `results.ts`, and [[submodule-web-chat]].
Pi's raw `structuredContent` reaches hooks but is not retained in finalized transcript messages.
The host stores bounded, base64-free presentation details so live and restored cards agree.
**Removal gate:** an equivalent bounded durable representation from pi. Re-check result shapes and
full-output paths; run `mcp/results.test.ts`, `mcpEngine.test.ts`, web MCP card tests and
`e2e/mcp-tool-cards.spec.ts`. Never persist the full raw result merely to delete the adapter.

## Other pi-sensitive host seams

**Registry-tool reconcile at attach** — [[submodule-server-agent]], `agentSessionManager.ts`. Pi ≥ 1.3
restores a resumed chat's recorded tool loadout and keeps recorded removals inactive, so a tool withheld
while its registry extension was disabled would stay off after re-enabling. Attach re-activates enabled
registry-extension tools by mirroring Pi's private `_isActivatedOnRegistration` (declarable exposure,
`defaultActive !== false`); re-check that rule on upgrades. If the host ever calls `navigateTree`, which
re-runs the restore, reconcile after it too. **Removal gate:** a public Pi way to keep host-withheld tools
apart from the recorded selection. Run the manager's restart regressions on upgrades.

- **Image-only queued input** — [[submodule-server-agent]], queue projection. The host compensates for
  pi's text-only delivered-message removal ([upstream #8612](https://github.com/earendil-works/pi/issues/8612))
  and retains image content lost by the destructive queue API. Remove the corresponding workaround
  when the installed implementation handles that case natively; verify the queue/image regressions,
  not just the issue state.
- **Bundled extension loading and image handling** — [[submodule-server-agent]], [[module-cli]],
  [[module-desktop]]. Forced Jiti transformation, virtual-module identity, static provider registration,
  and the image-resize override bridge resources a single-file artifact cannot discover or load.
  Replace each only when pi supplies an equivalent artifact seam; run `check:seams` and the relevant
  binary/desktop artifact probes, including extension value imports and images.
- **Headless theme** — [[submodule-server-agent]], `plainTextTheme`. Pi's terminal theme is not
  initialized by SDK session creation. Remove the subclass when pi supplies a usable non-TUI theme
  contract; run `webUiContext.test.ts` against the whole inherited surface.
- **Trust discovery and exclusion reloads** — [[submodule-server-agent]], `projectTrust.ts` and
  `extensions.ts`. Resource-kind discovery mirrors pi's private trust-requiring paths, while the
  excluding loader preserves reloadable extension paths and builtin exclusions. Prefer a public
  discovery/filter API when available; run `projectTrust.test.ts`, `extensions.test.ts` and
  `piRuntime.test.ts` on every change to resource loading.
- **Session discovery and prompt-template parsing** — [[submodule-server-history]],
  [[submodule-server-templates]], [[submodule-web-chat]]. The host mirrors pi's session directory/JSONL
  discovery and prompt-template/frontmatter rules where public APIs cannot serve its read/edit UI.
  Prefer public discovery/parsing APIs when they meet those needs; retain parity coverage in history,
  template and composer tests until then.

- **Detached result hold** — [[module-pi-subagents]] (Result delivery) and
  [[module-pi-background-commands]], applied by [[submodule-server-agent]]'s `turn_end` and
  `compaction_end` flushes. Pi drains follow-up messages only when a run would otherwise stop, offers
  extensions no way to inspect or withdraw one queued message (`hasPendingMessages()` is a boolean,
  `clearQueue()` is host-only and clears everything), and keeps queued messages across an abort, so a
  pushed result duplicated one the agent had already pulled. The owners hold outcomes and send them
  only at step boundaries or to an idle parent. **Removal gate:** a per-message queue handle an
  extension can withdraw, delivered at the next step rather than at run end — even then, keep the
  claim-on-pull rule. Run the `pi-subagents` and `pi-background-commands` suites and
  `agent/chatResources.test.ts`.

## Not temporary SDK workarounds

Project-server approvals, private project/chat overrides, confirmation policy, credential masking,
wire capability checks and React presentation are deliberate ThinkRail behavior. Their owners are
[[submodule-server-agent-mcp]] and [[submodule-server-agent]]. A pi upgrade does not silently remove
or weaken them. Reusing an upstream policy is a separate compatibility/product decision, not an
assumption that similarly named APIs have identical semantics.
