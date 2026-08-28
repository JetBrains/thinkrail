---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [v1, ui]
---

## Responsibility

The responsive frame and UI composition root: top-level app chrome, active-project/workspace routing,
theme application, global shortcuts, region error isolation, and composition of layout-agnostic panels into
the host-synchronized desktop workbench. A future mobile shell may project the same panels differently; it
must not inherit desktop docking accidentally.

## Boundary

- **Owns:** `Shell` as the one composition root; the topbar and persistent location context; active-workspace
  versus Project Home/Welcome branching; the single Settings and Toaster mounts; the theme DOM side effect;
  global keyboard chords; the injected Layout settings section (built-ins, custom-preset CRUD, default,
  apply, and independent side/bottom group limits); and the integration of `layout/` with store, transport,
  panel renderers,
  and region error boundaries.
- **Public surface:** `Shell`.
- **Allowed deps:** child `layout`; `panels`; `chat` app-integration hydration/rendering; `store`,
  `transport`, contracts (types only), `components/ui`, `components/ErrorBoundary`, `constants`, `lib`, and
  `themes`.
- **Forbidden:** server/shared/pi imports; being imported by panels/store/transport; putting arrangement
  knowledge into a feature panel.

## Internal modules

Every child is a directory module with `index.ts` as its public surface:

- `layout/` ([[submodule-web-shell-layout]]) is the pure workbench engine and renderer. It never imports
  feature panels, store/transport runtime, or persistence.
- `layoutSync/` ([[submodule-web-shell-layout-sync]]) owns host hydration, conflict-aware optimistic commits,
  and attention persistence/reconciliation.
- `layoutIntents/` ([[submodule-web-shell-layout-intents]]) owns consume-once intent routing into pure layout
  transactions.
- `chatReconciliation/` ([[submodule-web-shell-chat-reconciliation]]) owns session/placement/cache/history
  convergence and chat deep-link orchestration.
- `terminalReconciliation/` ([[submodule-web-shell-terminal-reconciliation]]) owns catalog/placement
  convergence without owning PTY lifetime.
- `legacySelection/` ([[submodule-web-shell-legacy-selection]]) is the sole temporary adapter from workbench
  attention to migration-era active editor/terminal/preview mirrors.

The sibling dependency graph is: `layoutSync → layout`; `chatReconciliation → layout + layoutSync`;
`terminalReconciliation → layout`; `layoutIntents → layout + chatReconciliation +
terminalReconciliation`; `legacySelection` reaches store selectors/actions only; and
`WorkspaceWorkbench` composes every orchestration barrel with `layout`, panels, and render callbacks. Chat
resource availability is isolated behind a per-session selector component; the parent workbench never
subscribes to the whole `sessions` record, so a streaming runtime cannot invalidate every tab renderer and
side tool behind it. Siblings import only through these barrels. Tests live with the orchestration module that
owns the behavior rather than making store tests import shell runtime synchronization.

## Composition

The topbar keeps ThinkRail identity, connection state, Settings, and a compact location context. The
identity is the icon-only ThinkRail mark — the same vector served as `public/favicon.svg`, inlined at
32×32 and rendered through the semantic `text-primary` colour so it stays legible in every theme — with
no divider between it and the location context. An active workspace shows a single-line
`project / workspace  branch · from baseBranch` context plus optional review metadata, all on one
typography token (`tr-text-ui` per [[web-typography]]) with only colour distinguishing the parts
(project + workspace in `text-text-default`, branch and trailing metadata in `text-text-muted`), with
progressive responsive degradation. A selected project without an active workspace shows Project Home.
No selected project leaves the logo alone.

With an active workspace, `Shell` mounts the synchronized workbench from `layout/`; the workbench owns all
center and left/right/bottom auxiliary geometry, alignment, and visibility. Without one, it mounts the
existing Welcome surface beside the projects navigator using separate client-local geometry—there is no
workspace layout document to mutate.
Toasts mount once above both branches.

The shell is also the sole theme side-effect owner: store receives the host-selected opaque theme through
transport; shell applies it atomically through `themes` and writes the local first-paint hint. No other
component mutates `[data-theme]`.

## Workbench behavior

The durable workbench grammar, synchronization behavior, and acceptance contract are owned by
[[submodule-web-shell-layout]]. In particular, the shell—not feature panels—routes open intents to the
browser's last-focused center group and folds accepted revisions into the workbench. Every replacement names
its exact accepted base revision (or create-only absence); a typed stale-base conflict installs the returned
current snapshot, unless a newer accepted broadcast already overtook the response, rolls back that optimistic
mutation and all dependents, and never automatically resends the stale full document. A nonmatching remote
commit cancels any uncommitted pointer gesture before replacement;
an acknowledgement matching the local optimistic base does not cancel a newer gesture begun on that document.
Browser-local attention is persisted
best-effort under a host-endpoint/workspace-qualified key, treated as untrusted on read, and structurally
validated before reconciliation. Every asynchronous reconciliation/hydration effect verifies that its
captured layout document and transient request are still the current store objects before installing cache
state or committing a follow-up. Authoritative layout, session, terminal, and resource reads are also
connection-generation stamped: a replay from an older socket cannot overwrite the fresh reconnect pass, and
coalescing keys include the generation where a newer pass must proceed independently. Chat-location
processing pauses behind optimistic writes, so an accepted
close can clear its request before a stale jump reopens the chat. A peer-restored chat placement repairs this
browser's render cache and history membership without selecting the tab; placed-chat hydration rechecks the
semantic placement after the read before installing its cache, and resource hydration otherwise remains a
separate background concern.

Project/file/change/review/chat/terminal views receive only resource identity, visibility, and container
bounds. Moving a view cannot change its module dependencies or make it inspect the layout tree. A visible
terminal is mounted through the layout visibility gate; hidden terminal tabs stay unmounted while their PTYs
continue running. After first layout seeding, the parent workbench—not `layoutSync`—creates the one initial
terminal placement only when the active host `Workspace` carries `initialTerminalEligible: true` and the
accepted version-2 document is still at revision 1. The marker scopes eligibility to records created with this
behavior; revision 1 scopes the attempt to the first layout snapshot, while the migration floor at revision 2
remains defense in depth for known version-1 layouts. Synchronization stays resource-lifetime-free. Before that
intent may commit, the parent reserves its client-minted key in the host catalog; the new-workspace seed uses
one deterministic key inside that workspace, so competing clients reserve and place the same terminal rather
than each creating one. Reservation is process-free and preserves a hidden configured default across reload
and peer reconciliation. A rejected reservation suppresses another automatic attempt within that connection
only; a later connection generation may retry the deterministic key, while confirmed membership or placement
ends seeding.
The placement intent can then retain hidden/folded geometry, and PTY attach still waits until the visibility
gate mounts it.

## Error resilience

Every independently mounted workbench resource body—including documents, terminals, and singleton tools—has
its own keyed region boundary, so one bad lazy panel cannot blank its containing workbench chrome, sibling
groups, or the shell. Switching
workspace or resource resets stuck region errors. Failed dynamic chunks offer a page reload rather than retrying the same stale module.
`main.tsx` retains the last-resort boundary around `Shell`.

## Global chords

`useGlobalHotkeys` remains the one capture-phase owner of app-wide chords. It routes commands through the
workbench command surface rather than imperative feature-panel refs:

- `Ctrl+R` opens chat history for the locally selected chat, or the workspace's most-recent chat fallback;
- `Mod+B` toggles the left side; restoring it focuses its last local group/tab or recreates an eligible
  singleton tool from its saved restore target when the side is empty;
- `Mod+J` does the same for the right side;
- `Mod+Shift+J` toggles bottom; restoring it focuses last local bottom attention, restores an eligible
  bottom-targeted singleton, or creates a terminal when structurally empty.

Letter chords match physical `KeyboardEvent.code`, never layout-dependent `key`. The three layout chords stay
app-owned inside xterm, do not repeat, and are suppressed while a modal dialog is open. With no active
workspace, the right/bottom workbench chords neither act nor swallow the browser chord; the established
Projects chord remains available. Terminal `Ctrl+R` still belongs to xterm;
`Ctrl+Shift+R`, macOS `Cmd+R`, F5, and the browser reload control remain untouched. All arrangement operations
beyond these shortcuts are exposed by the layout command/menu system described in
[[submodule-web-shell-layout]].
