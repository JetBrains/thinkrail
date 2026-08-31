---
id: submodule-web-shell-layout
type: submodule-design
status: active
title: shell/layout — frontend-local workbench frame
parent: submodule-web-shell
depends-on: [module-contracts]
tags: [ui, layout, tabs, drag-and-drop]
---

## Responsibility

The shell-owned, headless workbench engine: the normalized frontend-local frame and per-workspace view grammar; legal atomic mutations and projection; recursive center plus left/right/bottom rendering; resize/alignment and drag geometry; keyboard arrangement commands; and focus recovery. It renders containers; feature views remain arrangement-agnostic.

## Boundary

- **Owns:** web-local `WorkbenchFrame`/`WorkspaceViewState` types; frame-plus-view projection; pure topology, placement, attention, and policy operations; semantic minimum and independent group-limit checks; one-result drag previews; center/side/bottom renderers; alignment-owned nested composition and side-width projection; tab-strip overflow; ARIA tab/separator behavior; and the terminal visibility gate.
- **Public surface (`index.ts`):** all current-layout types; workbench renderer/controller; pure mutations, projection, and validation helpers; built-in preset definitions plus instantiate/apply/capture operations; attention fallback helpers; and unavailable-reason results. Callers inject resource renderers and commit complete pure results rather than splicing arrays.
- **External deps:** `@thinkrail/contracts` for the resource-free custom-preset DTO and git diff-scope type only; shell-neutral `lib` attention/id primitives; React; `react-resizable-panels`; `@dnd-kit/core`.
- **Forbidden:** server/shared/pi imports; domain-resource lifetime; browser persistence or WS calls; feature-panel internals; a mutable third-party docking model; inline component styles; or non-semantic colour values.

## State contract

One `WorkbenchFrame` belongs to a frontend surface, not a workspace. It carries stable group/split ids, center topology, left/right/bottom groups and geometry, auxiliary visibility/folds, bottom alignment, singleton-tool placement/order, and restore targets. It carries no workspace resource identity, preview, selected tab, navigation clock, pointer draft, or viewport compression.

A `WorkspaceViewState` is keyed by workspace and references frame group ids. It carries
file/diff/chat/document/terminal membership and order plus center preview identity. The separate
`LayoutAttention` overlay carries selection per group, last focus for center/each auxiliary region, and
per-group navigation clocks. The mounted workbench document is a pure projection of the singular frame,
active workspace view, and its attention; it is never stored as another authority.

Pure operations return either one complete local-state result or an unavailable reason. A resource-only
command patches the active workspace view. A frame command returns the frame plus every required
retained-workspace remap; the store installs that result atomically through
[[submodule-web-shell-layout-state]]. Components never splice groups or tabs. Stable ids are placement keys;
a tab's `name` remains non-identity metadata. Singleton tool names resolve from the current web-owned catalog
at presentation time, so copy updates never rewrite local layout state.

A click that may become a browser `dblclick` waits the shared 250 ms settle window. The upgraded gesture emits
only its final keep while retaining the leading preview-slot claim, whether content was cached or required a
host read. It never persists an intermediate preview. Pointer/resize drafts and viewport compression remain
runtime-only.

Frame groups may remain empty in any workspace. Closing a final resource therefore leaves topology untouched. Explicit remove/merge is the only way to delete a group, and its result rehomes every resource that references it across all locally retained workspace views. At least one center leaf always remains.

## Layout grammar

- **Center:** a recursive horizontal/vertical binary tree, maximum four leaves. A split replaces one leaf with equal halves. User creation/resize requires each child to remain at least 320 px wide and 180 px high. Empty leaves are valid frame slots and render the shell-provided empty surface. Remove/Merge promotes a sibling and rehomes every affected workspace's tabs deterministically.
- **Auxiliary eligibility:** Projects, Specs, Files, Changes, and Review are singleton auxiliary-only tools owned by the frame; terminals are workspace resources and may occupy center or any auxiliary region. Hiding a singleton preserves its restore target. View/deep-link reveal restores or unfolds it in frame-local position and focuses the requested item in current workspace attention.
- **Left/right:** ordered vertical frame stacks. Dragging an outer separator through its minimum hides that side, retains the last expanded width, and exposes its full-height restore rail. Broad upper/lower targets create groups before/after each row, including folded or currently empty rows. Expanded bodies have a 120 px normal minimum; folded groups occupy 27 px and retain normalized expanded weights. An empty frame group remains available across workspaces until explicit removal and renders a named
  Add/Reveal surface rather than disappearing; a region with groups may stay hidden.
- **Bottom:** ordered left-to-right frame groups resize on vertical separators. A group may fold to a 27 px
  vertical rail; the region hides to a 27 px-high horizontal restore rail over its selected span. Height starts
  at 30%, has a 120 px body minimum, and caps at 70%. Alignment is center, center+left, center+right, or full
  workbench. A side excluded from that span owns its lower corner and continues to the workbench bottom; an
  included side ends above it. Hidden restore geometry follows the same ownership. Alignment follows actual
  browser-local side projection during resize and narrow compression while persisted workbench-wide frame
  ratios remain the target and are converted through nested panel groups. A separator gesture commits only
  the ratio of the side that owns it; compression of an untouched neighbor remains runtime-local. Hidden
  sides contribute no phantom width. Empty bottom slots render terminal creation/reveal affordances.
- **Limits:** left/right share a local setting defaulting to six groups per side; bottom has an independent local setting defaulting to three. Both accept 1–32, with closed hard safety bounds enforced even for untrusted local state or shared presets. Existing overages survive; creation is unavailable until below the configured limit, while reorder/join/reducing moves remain legal. Stable-id uniqueness, one canonical resource placement per workspace view, normalized geometry, and the final-center-leaf invariant are enforced by every mutation.
- **Small viewports:** restoring onto less space may compress below operation minimums locally. Content scrolls/clips; bottom alignment projects from actual compressed side spans, while frame topology, alignment choice, and ratios are never rewritten merely because this viewport is narrow.

Ordinary opens target the active workspace's last-focused surviving center group. Reopening a canonical resource selects its existing local placement rather than duplicating it and refreshes non-identity metadata in place. Each center group has one workspace-local preview slot: preview replaces in place, keep promotes one-way, and navigation clocks are group-local. A passive restore may select its first result without incrementing the user-navigation clock. A user open advances its clock at request time and carries that stamp through acceptance rather than counting twice; reselecting the active center tab also advances once so it defeats older deferred work. Incidental DOM focus changes update last-focus routing but not navigation.

Async completion reroutes from a removed group to current last focus and advances the surviving destination once, unless newer local placement already contains the resource. File/chat/document closes update local attention immediately. Terminal close waits for host-domain acceptance, then removes that terminal from every local workspace view for the workspace; a rejection leaves placement and attention untouched. Any newer tab gesture or navigation suppresses delayed close-focus recovery.

## Arrangement and accessibility

A tab drag paints exactly one result: strip insertion, whole-group join, legal center half-split, side upper/lower boundary, or bottom left/right boundary. Expanded strips remain join/reorder targets while bodies create adjacent groups; folded rails divide their compact axis between the same two targets. Hidden restore rails are broad legal creation targets within local limits. Illegal domains, limits, exact-position no-ops, and minimum violations paint no target and commit nothing. Escape, pointer cancellation, outside drop, or a superseding local frame/view transition restores the source. Drag moves one workspace resource or one frame-owned tool; it never copies or crosses workspaces.

Creating or deleting a group is visibly a frame command and therefore affects every workspace in this window. Moving a resource among existing groups affects only its workspace view. Moving a singleton tool changes frame placement globally within this window. Uncommitted drag/resize drafts stay runtime-local and commit once on drop/pointer-up; no host revision can cancel them. A local projection epoch invalidates drafts or delayed preview-settle timers only when another local transition replaces their base.

Pointer is never the sole arrangement path. Keyboard controls and shadcn menus cover group/tab focus, select/close/keep/reorder/move, directional center splits, absolute and adjacent auxiliary-group creation, explicit group remove/merge, fold/show/hide/tool restore, bottom alignment, and keyboard separator resize, always with an unavailable reason. A tab can reproduce every interior pointer placement through move plus New group. Tab strips implement WAI-ARIA tabs and visible roving focus. A folded auxiliary group retains its linked native-hidden tabpanel while unmounting the body; its restore control is the focus endpoint when no tab renders. A local fold moves focus to that control and expansion returns it to the selected tab. Separators expose orientation and current/min/max values. `Ctrl+F6` visits upper-row groups in visual order, then visible bottom groups left-to-right.

One-row strips have bounded readable tab widths and no fixed previous/next controls: wheel, trackpad, touch,
roving-keyboard navigation, active reveal, and the searchable keyboard overflow list scroll the same list.
Native scrollbars stay hidden; pointer-transparent edge fades appear only where clipped and update without
changing the fixed 32 px strip. Full-height strip actions share that width. A control renders only when it can
act: overflow search only while clipped, and fold only while a side has multiple groups or is already folded.
Singleton tool tabs have no inline close glyph; Close/Hide stays in their menu and on Delete, while terminals
and center resources retain their direct control.

Each auxiliary strip trails an add-to-this-group menu. It offers shell-injected actions plus unplaced tools valid for that region; two rails never offer the same singleton. Center tab menus offer no singleton tools. A terminal created from an auxiliary group lands in that workspace's matching group; a vanished target reroutes through the current local focus rule.

## Presets and local persistence

Balanced, Focus, and Review are web-owned resource-free frame definitions with a below-center bottom slot:
Balanced and Review show it; Focus hides it. Balanced and Focus start with one center group; Review provides
its deliberate vertical pair. Custom presets use the same grammar and capture geometry,
topology, tools, folds, and empty structural slots, never workspace resources or terminal count. Preset node
ids are template-local labels: instantiation mints frontend-local frame ids and returns the old→new group map
used to rehome every workspace view. Only custom definitions cross the wire through settings.

Applying a preset creates one replacement frame, raises this surface's local side/bottom limits if required, and remaps all retained workspace views atomically. Center resources preserve visual order and distribute across destination leaves; terminals map into compatible slots; singleton tool placement ids survive where possible. Omitted tools receive deterministic restore targets, so a sparse preset cannot strand Projects or another tool. The local default preset is the target of the explicit Reset frame command; ordinary workspace switches retain the current frame. Default selection and limits persist locally, not in host settings.

`layoutState` validates and persists the normalized frame/views/attention document under endpoint + frontend-surface identity. Reload and supported session restoration reuse it; simultaneous windows never consume each other's storage events. Persistence contains references only. Failure leaves live state intact; unknown schema falls back to the Balanced safe frame.

The complete current-layout grammar, including the derived `WorkspaceLayoutDocument` projection consumed by existing shell renderers, is web-local. A pristine surface instantiates Balanced; no host snapshot or prior layout schema is imported.

The terminal visibility gate mounts a body only for a terminal locally selected in an unfolded visible group. Distinct terminal identities may mount concurrently; one identity has one body per browser surface. Inactive/folded/hidden tabs never attach. Global New Terminal targets last local bottom focus, creating a frame slot only through an explicit frame command; center Group Header creation captures that group. Host catalog reconciliation may place an unrepresented terminal locally without selecting it, but cannot change frame geometry.
