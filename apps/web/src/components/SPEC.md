---
id: submodule-web-components
type: submodule-design
status: active
title: components — shared UI primitives
parent: module-web
tags: [v1, ui, resilience]
---

## Responsibility

The app's dependency-light shared React primitives: the error boundary that keeps one failed region from
unmounting the root, project-custom icons, the quiet-scroll frame used by shell and feature panels, and
the shared loading-skeleton primitive. Also houses the `ui/` sub-module (shadcn primitives), which has
its own spec.

## Boundary

- **Owns:** `ErrorBoundary.tsx` — a class boundary (`getDerivedStateFromError`) that renders a themed,
  self-contained fallback instead of propagating a throw to the root. It:
  - resets a caught error when any `resetKeys` value changes (wire to the subtree's identity —
    workspace/tab id — so navigating away auto-recovers);
  - classifies failed dynamic `import()`s via the pure, unit-tested **`isChunkLoadError`** (stale Vite
    chunk / 504 / Safari "module script failed") and steers those to a page **reload** (re-fetches the
    chunk) rather than an in-place retry;
  - logs the crash to the console (`componentDidCatch`) — the UI already degrades gracefully.
- **`CustomIcon.tsx`** — renders an SVG from `public/custom-icons/` as a themeable `currentColor` glyph
  via a CSS `mask-image` span (`.custom-icon*` classes in `index.css`), so a custom glyph sizes with
  `size-*` and colours with `text-*` exactly like a Remix icon. Names are a typed union
  (`CustomIconName`); today: `file-diff-line`/`file-diff-fill` (the Changes tool glyph).
- **`QuietScrollArea.tsx`** — the store-free overflow observer and two presentation surfaces:
  `QuietScrollArea` owns an ordinary native scroll viewport, while `QuietScrollFrame` observes a
  third-party descendant scroll control without taking over its content or input and can receive the
  library's authoritative edge state. Native areas use the shared 6px scrollbar gutter, revealing a 5px
  optical thumb on hover/focus-within/drag/active scrolling and the full 6px thumb on direct hover. A
  third-party frame preserves that library's wider hit geometry while replacing only the optical slider;
  the underlying slider stays transparent through its base, hover, and active states. Authoritative edges
  also declare vertical overflow, so xterm's controller can remain visible for local intent and accessibility
  modes only when scrollback exists. Pointer intent lasts through release or cancellation, including a drag
  that leaves the frame. Both surfaces paint pointer-transparent 16px curtains only on clipped directions.
  Native measurement follows scroll, viewport/content resize, and descendant replacement. Bundled
  high-contrast themes retain a resting hairline; OS forced-colours mode keeps a visible system-colour thumb
  and removes the cosmetic curtains; reduced motion removes both optical and third-party controller opacity
  transitions. Surface colour is an explicit semantic prop (`sidebar` or `terminal`), never inferred from
  arrangement.
- **Also owns:** `Skeleton.tsx` — `SkeletonRows`, the one pulsing-rows placeholder every loading surface
  uses, and `LoadingRegion`, the sized-wrapper shape around it that most call sites actually want (a
  `className` for the region's own padding/sizing, an optional `label` threaded to `SkeletonRows`'
  `role="status"` region rather than opening a second one, and an optional `testId`). The full loading
  vocabulary and its rules are below.
- **Public surface:** `ErrorBoundary`, `isChunkLoadError`, `SkeletonRows`, `LoadingRegion` — imported
  directly via `@/components/ErrorBoundary` / `@/components/Skeleton` (no barrel); `CustomIcon`,
  `CustomIconName` via `@/components/CustomIcon`; `QuietScrollArea`, `QuietScrollFrame`, and the
  `QuietScrollEdges` type via `@/components/QuietScrollArea`. The `ui/` primitives are their own sub-module
  ([components/ui/SPEC.md](ui/SPEC.md)).
- **Allowed deps:** React, `@remixicon/react`, `lib` (`shallowEqualArrays` — the reset-keys comparison, shared
  rather than re-stated). Kept dependency-light on purpose, and `lib` is a leaf, so *any* region (shell,
  panels, `main.tsx`) can still wrap in it without creating a cycle.
- **Forbidden:** `store`/`transport`/`panels`/`shell`/`chat`/`contracts`; `server`/`shared`/`pi`; inline
  `style` objects or raw hex (fallback is themed with token utilities only).

## Loading vocabulary

The app's loading vocabulary is exactly **two-tier** — every async gap renders one of these two, never a
third thing, never bare text, never nothing:

1. **`SkeletonRows` (usually via `LoadingRegion`) — for a *content region***: any area that will fill with substantial content, however
   that region is framed (a tool panel, a dialog's list, a menu's list section, a tab body, a `Suspense`
   fallback restoring a chat/plan/editor). **Surface size decides the tier, not the container type** — a
   spinner centred in a large empty region reads as a heavier, more alarming kind of wait than the
   content-shaped skeleton used one panel over for the identical "data is on the way" situation, so a
   region is never spinner-only regardless of what widget it lives inside (a dialog, a dropdown, a
   workbench tab). Reference sites: `panels/FileTree.tsx`, `panels/SpecsPanel.tsx`,
   `panels/ChangesPanel.tsx`, `panels/ReviewPanel.tsx`, `panels/PlanPane.tsx`, `panels/ProjectTree.tsx`
   (worktree list), `panels/ExistingWorktreeDialog.tsx` (worktree-candidate list),
   `panels/ChangesScopeMenu.tsx` (commit list), `panels/WelcomePanel.tsx`'s `CardSkeleton` (a hand-shaped
   variant sized to the cards it stands in for, since a generic row list would misrepresent a card grid's
   footprint), and `shell/WorkspaceWorkbench.tsx`'s `MissingResource` (every chat/plan/editor tab-body and
   lazy-chunk `Suspense` fallback).
2. **`Loader2` spinner (usually beside a short label) — for an *in-flight action or transient state* pinned
   to its control**: a single button, one menu item, one icon — never a whole region. Reference sites:
   the "New chat"/"Creating…" button states, `shell/WorkspaceChatHistory.tsx`'s history icon,
   `chat/ActivityGroup.tsx`/`chat/ToolCard.tsx` step icons, `panels/ProjectTree.tsx`'s "Creating worktree…"
   pending row. A narrower named sub-idiom of this tier: **`RefreshCw` spinning in place** (icon unchanged,
   just rotating) for a manual "Refresh" action on a control whose surrounding content stays visible and
   valid while the refresh runs (`chat/ModelSelector.tsx`, `panels/GithubSettings.tsx`,
   `panels/ProvidersSettings.tsx`, `panels/BranchPicker.tsx`) — swapping to a generic spinner there would
   discard the "this still works, just refreshing" signal the in-place spin gives for free.

Beyond picking the right tier:

- **No layout jump.** A loading state occupies the same footprint the arriving content will — a skeleton
  sized/shaped for its region, a `CardSkeleton` sized like the card it precedes — so the data replacing it
  never shifts anything around it.
- **A retry/error affordance is never paired with an active loading indicator.** Showing "Retry" next to a
  spinner or skeleton sends two contradictory signals at once ("this is normal, wait" and "this already
  failed, act") for what is, in the overwhelming majority of cases, still-normal loading. Two legitimate
  shapes: (a) the retry button appears **only after a real failure** — a rejected request lands in a
  `catch`, e.g. `panels/ChangesPanel.tsx`'s `changes-retry`, `panels/ExistingWorktreeDialog.tsx`'s
  `existing-worktree-retry`; or (b) for a resource an *automatic* background process is already racing to
  restore (chat-session hydration via `shell/chatReconciliation`), the loading indicator shows alone and a
  retry affordance surfaces only once that automatic attempt has stayed stalled past a short grace window —
  `shell/WorkspaceWorkbench.tsx`'s `ChatResourceBody`/`CHAT_RETRY_DELAY_MS` is the reference
  implementation; reach for the same shape before inventing a new one.
- **Conditionally-absent content is not a loading state.** When "still loading" and "definitely nothing
  here" render identically (both blank) *and* blank is the correct steady state — not merely an
  unhandled gap — showing nothing while unresolved is correct, not a defect: `chat/ChatPlan.tsx`'s
  `plan.data === null` guard is gated at its call site (`chat/ChatView.tsx` only mounts the plan
  strip/popover once `plan.data` exists at all), so there is no "empty region promising content" the way
  `panels/WelcomePanel.tsx`'s always-eventually-populated card row has. Reach for a skeleton only when the
  region is guaranteed to fill; reach for nothing only when it may legitimately never fill and the caller
  already treats absence as absence, not as a pending state.
- Bare "Loading…"/"Restoring…" text with neither a skeleton nor a spinner is a defect, full stop.
- **The resolved content fades in rather than popping in.** Once a skeleton's data arrives, the element that
  replaces it carries `motion-safe:animate-reveal` (`index.css`'s shared `reveal` keyframe — 150ms
  opacity+translateY, the same primitive `chat/tools/AskUserQuestionCard.tsx` already uses for a card
  settling into place; `motion-safe:` so `prefers-reduced-motion` gets an instant swap instead). It goes on
  the resolved branch's own root — never the skeleton, never a wrapper that also encloses the skeleton
  branch (a `Suspense` boundary's *children*, not the `Suspense` element itself) — because the animation
  plays once on that element's mount, and a shared wrapper around both branches would fire on first paint,
  before the data (or the resolved content itself) exists to fade in. It never re-fires on ordinary
  re-renders (a longer todo list, a new chat message) because React reconciles the same persistent DOM node
  across those — only the branch switch is a real mount. `panels/DiffPane.tsx`/`panels/FilePane.tsx` wrap
  `RenderedDiff`/`MarkdownPreview`'s lazy `Suspense` children in it — but pointedly **not** `MonacoDiff`/
  `MonacoEditor`'s: `@monaco-editor/react` shows its own second `loading={<SkeletonRows/>}` internally while
  Monaco's own runtime boots, *after* our `Suspense` chunk has already resolved, so wrapping our `Suspense`
  boundary there fades in — a still-loading skeleton, not the real editor, an animated flash into a second,
  unanimated skeleton swap that reads as two different loading indicators blinking rather than one. The
  correct fix for that stacked case would live inside `MonacoEditor`/`MonacoDiff`'s own `loading` render
  (an internal library-boot state we don't otherwise touch), not at the outer call site — left unanimated
  until that's worth doing. A terminal body (`TerminalWorkbenchBody`) skips the reveal too, since a
  terminal's PTY attach is gated on its own visibility mount and is not worth risking for a cosmetic fade,
  and a Radix menu's items skip it as well, since wrapping bare `DropdownMenuItem`s in a div breaks the
  primitive's direct-child keyboard/typeahead traversal (`panels/ChangesScopeMenu.tsx`'s commit list stays
  skeleton-then-pop for this reason). `chat/ChatView.tsx`
  skips it for a sharper reason: a non-`none` `transform` on an ancestor — including mid-animation, before
  the keyframe settles at `none` — establishes a new containing block, which broke the sticky positioning
  of `chat/activityBreadcrumbs.tsx`'s breadcrumb bar nested inside it (`e2e/activity-breadcrumbs.spec.ts`
  caught this in review). Anything with a `position: sticky`/`fixed` descendant is disqualified from this
  transform-based reveal outright, no exception list needed — check for one before adding it.

## Get right

- **Scope of protection:** React boundaries catch **render + lazy-import** throws only — **not** errors in
  event handlers, effects, or rejected promises (e.g. `transport.request`). Those surface through
  `transport`'s `errorText()` as an error turn/notice, not here. The shell's "panels can't blank the app"
  guarantee is about render/lazy-load; async failures are a separate path.
- Where the error boundary is mounted (each region + the last-resort root wrap) is owned by `shell/SPEC.md`
  and the parent dependency graph in `apps/web/SPEC.md`, not repeated here.
- Quiet-scroll intent is local to its rendered surface, not the workbench's remembered active group. A
  wheel/trackpad gesture need not move DOM focus, while remembered group focus would leave one rail visible
  indefinitely. The third-party frame therefore observes focus and pointer intent at its own host and adds
  only a visual/measurement adapter; it never reads shell placement.
