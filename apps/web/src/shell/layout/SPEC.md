---
id: submodule-web-shell-layout
type: submodule-design
status: active
title: shell/layout — synchronized workbench layout
parent: submodule-web-shell
depends-on: [module-contracts]
tags: [ui, layout, tabs, drag-and-drop]
---

## Responsibility

The shell-owned, headless workbench engine: legal layout mutations, recursive center plus left/right/bottom
auxiliary rendering, resize/alignment and drag geometry, keyboard arrangement commands, and focus recovery
for the host-synchronized `WorkspaceLayoutDocument`. It renders containers; feature views remain
arrangement-agnostic.

## Boundary

- **Owns:** the pure topology/policy operations; semantic minimum and independent group-limit checks;
  one-result drag previews; center/side/bottom renderers; alignment-owned nested workbench composition and
  side-width projection; tab-strip overflow; ARIA tab/separator behavior; and the visibility gate that mounts
  a terminal body only while that terminal is selected in a visible, unfolded group.
- **Public surface (`index.ts`):** the workbench renderer/controller, pure document mutations and invariant
  validator, built-in preset definitions + instantiate/refill operations, attention-fallback helpers, and
  their web-only types. Callers pass resource/tool render callbacks rather
  than importing feature views here.
- **External deps:** `@thinkrail/contracts` (layout/resource types), shell-neutral `lib` attention/id
  primitives, React, `react-resizable-panels`, `@dnd-kit/core`.
- **Forbidden:** server/shared/pi imports; owning domain-resource lifetime; direct persistence or WS calls;
  importing panel internals; a mutable third-party docking model; inline component styles or non-semantic
  colour values.

## State contract

The parent shell is the integration boundary: it supplies accepted store state, device-local attention,
commit/error callbacks, current layout settings, and feature renderers. Every structural operation is a pure
`WorkspaceLayoutDocument → result | unavailable-reason` transaction. A successful discrete command emits
one complete document; components never splice the store's group/tab arrays.

The shared document carries topology, stable group/split ids, tab membership/order, per-center-group preview
identity, auxiliary visibility/folds, bottom alignment, restore targets, and normalized geometry. A click that
may still become a
browser `dblclick` waits one shared 250 ms settle window; the upgraded gesture emits only its final keep while
retaining the leading preview-slot claim, whether content was already cached or required a host read. It never carries selected tabs,
focus, navigation clocks, pointer drafts, or viewport compression. The browser-local attention overlay keeps
selection per group plus last focus for center/each auxiliary region and a zero-initialized clock for every
center leaf;
structural replacement reconciles it to the nearest surviving identity and prunes removed-group clocks without
publishing. A tab's stored `name` is non-identity metadata. Singleton tool names resolve from the current
web-owned catalog at presentation time, so a vocabulary update reaches old snapshots without spending a
shared-layout revision merely to rewrite display copy.

## Layout grammar

- **Center:** a recursive horizontal/vertical binary tree, maximum four leaves. A split replaces one leaf
  with equal halves. User creation/resize requires each child to remain at least 320 px wide and 180 px high.
  Losing a leaf's final tab removes that leaf and promotes its sibling; one final empty leaf always remains.
- **Auxiliary eligibility:** Projects, Specs, Files, Changes, and Review are singleton auxiliary-only
  tools; terminals may cross between center and any auxiliary region. Closing a singleton keeps its local
  feature state and restore target; a View/deep-link reveal restores or unfolds it in place and focuses the
  requested item.
- **Left/right:** ordered vertical stacks retain the established behavior. Dragging an outer separator through
  its minimum hides that side through the shared visibility transaction, retains the last expanded width, and
  exposes its full-height restore rail. Broad upper/lower targets create groups before/after each row, including
  folded rows. Empty groups disappear and an empty side auto-hides. Expanded bodies have a 120 px normal
  minimum; independently folded groups occupy 27 px and retain normalized expanded weights.
- **Bottom:** ordered left-to-right groups resize on vertical separators. A group may fold to a 27 px-wide
  vertical rail; the whole region hides to a 27 px-high horizontal restore rail over its selected span. Height
  starts at 30%, has a 120 px body minimum, and caps at 70%. Alignment is one of center, center+left,
  center+right, or full workbench. A side excluded from that span owns its lower corner and its real stack
  continues to the workbench bottom; an included side ends above the bottom surface. The hidden restore rail
  follows the same ownership. Alignment composition follows actual browser-local side projection during a
  resize gesture and narrow-width compression, while persisted workbench-wide side ratios remain the durable
  target and are converted through nested panel groups. A separator gesture publishes only the ratio of the
  side that owns that separator; compression of an untouched neighbor remains browser-local. A hidden side
  contributes no phantom width and joins
  the span only when shown. Broad left/right targets create groups at every boundary. Empty structural slots
  remain legal for portable terminal layouts and the deliberate process-free New Terminal state. Closing or
  moving a group's final tab removes only that newly vacated group, renormalizes survivors, and auto-hides when
  no populated group remains.
- **Limits:** left/right share the host setting that defaults to six groups per side; bottom has an independent
  setting defaulting to three. Both accept 1–32. Existing overages survive; creation is unavailable until the
  region falls below its limit, while reorder/join/reducing moves remain legal. Domain eligibility, stable-id
  uniqueness, one canonical placement per resource, normalized geometry, and the final-center-leaf invariant
  are enforced by every mutation.
- **Small viewports:** restoring onto less space may compress below operation minimums locally. Content
  scrolls/clips; bottom alignment projects from those actual compressed side spans, while the shared topology,
  alignment choice, and ratios are never rewritten merely because this viewport is narrow.

Ordinary opens target this browser's last-focused surviving center group. Reopening a canonical resource
selects its existing placement instead of duplicating it and refreshes non-identity metadata such as a chat
label in place. Each center group has one preview slot: preview
replaces in place, keep promotes one-way, and navigation clocks are group-local. A passive automatic restore
may select its first result without incrementing that user-navigation clock. A user open advances its clock
at request time and carries that stamp through acceptance instead of counting again; explicitly clicking or
choosing the already-selected center tab also advances once, because that deliberate re-selection must beat
older deferred work. Incidental/programmatic DOM focus capture only updates last-focus routing and is
count-neutral, preventing a Group Header click or focus-restoration request from counting twice. An async completion
reroutes from a removed destination to current last focus (advancing that surviving destination once), unless
a newer shared snapshot already placed the resource. A user close advances attention and compatibility
navigation exactly once only after structural acceptance (or after an authoritative terminal close); a
rejected layout write leaves the resource, focus, and navigation clocks untouched. The overtaken test
compares the workspace's center-navigation tick captured at close request against acceptance time —
navigation the attention clocks cannot see (an incoming Back/Forward route bumps the tick at adoption,
before its authoritative read) still makes the acceptance count as overtaken instead of cancelling it. Delayed terminal close
settlement resolves the resource semantically against the latest document, so a move is followed while an
unrelated resource that reused the old opaque placement id is never closed. Any newer tab gesture or center
navigation suppresses delayed close-focus recovery; structural reconciliation that removes the closing group's
clock does not impersonate such navigation, so collapsing the final tab in a leaf still restores visible tab focus.
When closing a populated auxiliary group hides its region while an intentional empty bottom slot survives,
focus falls back to the last center group rather than targeting the unrendered hidden group.

## Arrangement and accessibility

A tab drag paints exactly one result: strip insertion, whole-group join, legal center half-split, a side
upper/lower boundary, or a bottom left/right boundary. Expanded tab strips remain join/reorder targets while
content halves create adjacent groups; folded rails divide their compact axis between the same two targets.
The user never has to acquire a thin outer edge. Hidden left/right rails become broad creation targets for an
eligible tab within that side's limit. A hidden bottom rail instead reuses the last-focused surviving bottom
slot, creating one at the trailing boundary only when no slot exists; either drop reveals the region. Illegal
domains, limits, exact-position no-ops, or minimums paint no valid target and commit nothing. Escape, pointer
cancellation, outside drop, or a superseding remote revision restores the source. Drag moves one tab
only—never copies, crosses workspaces, or moves a whole group.

Pointer is never the sole arrangement path. Keyboard controls and the shadcn menu surface cover group/tab
focus, select/close/keep/reorder/move, directional center splits, absolute and adjacent auxiliary-group
creation, fold/show/hide/tool restore, bottom alignment, and keyboard separator resize, always with an
unavailable reason. A tab can reproduce any interior pointer placement by moving into the destination group
and invoking New group above/below or left/right. Tab strips implement the WAI-ARIA tabs pattern and visible
roving focus; a folded auxiliary group retains its linked native-hidden tabpanel while unmounting the body,
and its named restore control is the group focus endpoint when no tab control is rendered. A local bottom-fold
transition moves focus onto that restore control and expansion returns it to the selected tab. Separators expose
orientation and current/min/max values. `Ctrl+F6` visits upper-row groups in visual
order, then visible bottom groups left-to-right. One-row strips have bounded readable tab widths and no
fixed previous/next controls: wheel, trackpad, touch, roving-keyboard navigation, active reveal, and the
searchable keyboard overflow list all scroll the same tab list. Its native scrollbar stays hidden; subtle,
pointer-transparent edge fades appear only on directions with clipped tabs and update with scroll, resize, and
tab changes without altering the fixed 32 px strip or tab geometry. Full-height strip actions share that 32 px
width, keeping search, creation, alignment, and fold controls square. A strip control renders only when it
can act: the searchable overflow list while the tab list overflows its scroller, the fold button while the
side holds more than one group (or the group is already folded) — folding a lone group buys no space from a
neighbour. Singleton tool tabs
(Projects, Specs, Files, Changes, Review) carry no inline close glyph; Close remains in their context menu
and on the Delete key, while terminals and center resources retain the direct glyph.

Every side strip trails an add-to-this-group menu, so recovery does not depend on discovering the tab
context menu. It offers app actions injected via `renderSideMenuActions(side, groupId)` (New terminal, right
side only — the render prop keeps store-bound creation out of this module) above the tools
`unplacedToolsForSide` reports for **this** side, so the two rails never offer the same tool. A side tab's
context menu stays document-wide; a center tab's offers no tools at all — they open in the side regions, and
listing them under a terminal tab put "Show Review" in a menu that is neither where it would open nor
anything to do with the tab clicked. Both read "Show <tool>" — a tool may never have been opened. A terminal
placed here lands in the group whose menu was used: the action names that side as the intent's target area,
so no center navigation routing applies.

## Presets and synchronization

Balanced, Focus, and Review are web-owned portable definitions with one below-center bottom slot: Balanced
and Review show it, Focus hides it. Custom presets use the same resource-free shape and capture bottom
height/alignment/folds/weights plus empty structural slots. Terminal identity and count never enter a preset.
Instantiation fills resources deterministically, prunes unused center leaves, and never imports a foreign
workspace identity. Selecting, applying, or first-seeding raises the independent side/bottom limits first
when topology requires it; existing overages otherwise remain grandfathered.

Applying a bottom-aware preset moves all terminals into its bottom slots: one per group left-to-right, then
remaining terminals in the first group. With no terminal, a visible slot stays process-free and renders New
Terminal. Center resources still seed one per leaf with the remainder in the primary leaf. Existing
singleton-tool placement ids survive relocation, and a newly materialized tool receives a fresh
placement-only id when its conventional id is already owned by another semantic resource. Omitted singleton
tools stay deliberately unplaced but receive default/prior auxiliary restore targets, so an empty portable
preset can never strand the user without a Projects/tool recovery path. Version-1 layouts/custom presets
normalize to hidden empty bottom without moving a resource.

Pointer drag/resize drafts remain local and emit one snapshot only on drop/pointer-up. Nested outer and
aligned-row groups project active side-resize drafts through one browser-local workbench-wide coordinate
space without publishing that transient geometry. A newer accepted
revision whose mutation id does not match this client's optimistic base cancels the draft, makes release
inert, and lets the parent explain the cancellation; the same projection epoch invalidates a pending
preview-click settle timer before it can publish from the replaced document. A matching acknowledgement
advances the accepted revision without cancelling a newer draft begun on that document. The parent
`layoutSync` module supplies exact-base optimistic concurrency: a stale replacement conflict installs host
current state and advances the same projection epoch, while this pure module remains unaware of transport,
persistence, and optimistic queues.

The terminal visibility gate mounts a body only for a terminal locally selected in an unfolded visible group.
Several distinct terminal identities may mount concurrently; the same identity has one body per browser, and
inactive/folded/hidden terminal tabs never attach. Global New Terminal targets and reveals last bottom focus,
creating a bottom slot if needed; every center Group Header retains a contextual New terminal command that
captures that center group. A vanished captured group reroutes through the corresponding current-focus rule.
