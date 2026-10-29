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
   pending row. On a shared button this tier is `loading` (icon-sized spinner in the icon's place). A
   narrower named sub-idiom of this tier: **`RefreshCw` spinning in place** (icon unchanged, just rotating;
   a shared button spells it `loading spinIcon`) for a manual "Refresh" action on a control whose surrounding content stays visible and
   valid while the refresh runs (`chat/ModelEffortPicker.tsx`, `chat/ModelSelector.tsx`, `panels/GithubSettings.tsx`,
   `panels/ProvidersSettings.tsx`, `panels/BranchPicker.tsx`) — swapping to a generic spinner there would
   discard the "this still works, just refreshing" signal the in-place spin gives for free. Under reduced
   motion a rotation cannot carry the signal, so `spinIcon` shows the static spinner glyph instead.

Beyond picking the right tier:

- **The skeleton fades in after a grace, never flashes.** `SkeletonRows` carries `animate-loading-in`
  (`index.css`: invisible for 300ms, then a 150ms opacity fade), so a read that resolves within the grace
  goes straight from the blank, already-sized region to the revealed content instead of blinking a
  skeleton for a frame or two (opening a Changes tab was the visible case). It stays mounted throughout, so
  its `role="status"` region and test ids are present from the first paint; only its opacity waits.
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
  unhandled gap: showing nothing while unresolved is correct, not a defect. `panels/PlanRailPane.tsx`
  surfaces a small "Loading…" line via its `plan.data === null` branch because the rail tool may open
  before the first plan read lands and "empty" is a valid steady state; there is no empty region
  promising content the way `panels/WelcomePanel.tsx`'s always-eventually-populated card row has.
  Reach for a skeleton only when the
  region is guaranteed to fill; reach for nothing only when it may legitimately never fill and the caller
  already treats absence as absence, not as a pending state.
- Bare "Loading…"/"Restoring…" text with neither a skeleton nor a spinner is a defect, full stop.
- **The resolved content fades in rather than popping in.** Once a skeleton's data arrives, the element that
  replaces it carries `motion-safe:animate-reveal` (`index.css`'s shared `reveal` keyframe — 150ms
  opacity+translateY, the same primitive the questionnaire card ([[module-ext-ask-user-question]]) already uses for a card
  settling into place; `motion-safe:` so `prefers-reduced-motion` gets an instant swap instead). It goes on
  the resolved branch's own root — never the skeleton, never a wrapper that also encloses the skeleton
  branch (a `Suspense` boundary's *children*, not the `Suspense` element itself) — because the animation
  plays once on that element's mount, and a shared wrapper around both branches would fire on first paint,
  before the data (or the resolved content itself) exists to fade in. It never re-fires on ordinary
  re-renders (a longer todo list, a new chat message) because React reconciles the same persistent DOM node
  across those — only the branch switch is a real mount. The registered `RenderedDiff`/`MarkdownPreview`
  roots carry it — but pointedly **not** `MonacoEditor`'s: the editor appears in the same commit as its
  view, with no internal loading state, and a 150ms fade would only delay readable text. A terminal body
  (`TerminalWorkbenchBody`) skips the reveal too, since a terminal's PTY attach is gated on its own
  visibility mount and is not worth risking for a cosmetic fade,
  and a Radix menu's items skip it as well, since wrapping bare `DropdownMenuItem`s in a div breaks the
  primitive's direct-child keyboard/typeahead traversal (`panels/ChangesScopeMenu.tsx`'s commit list stays
  skeleton-then-pop for this reason). `chat/ChatView.tsx`
  skips it for a sharper reason: a non-`none` `transform` on an ancestor — including mid-animation, before
  the keyframe settles at `none` — establishes a new containing block, which broke the sticky positioning
  of `chat/activityBreadcrumbs.tsx`'s breadcrumb bar nested inside it (`e2e/activity-breadcrumbs.spec.ts`
  caught this in review). Anything with a `position: sticky`/`fixed` descendant is disqualified from this
  transform-based reveal outright, no exception list needed — check for one before adding it.
