---
id: module-resource-renderers
type: module-design
status: active
title: "@thinkrail/resource-renderers — file and diff renderers, registry and review surfaces"
parent: architecture
depends-on: [module-contracts, module-locales, module-ui]
references: [submodule-web-panels, submodule-web-chat]
---

## Responsibility

Everything that turns a workspace resource into a viewable, reviewable surface: the engine-neutral resource
description and renderer registry, the eleven bundled file/diff renderers (code, markdown, binary, LFS,
image, SVG, CSV, JSON, notebook, PDF, HTML) with their review composers, thread cards and region surfaces,
and the shared Monaco, Pierre and markdown-document machinery they run on. It is presentation: it owns no
content loading, review persistence, tabs or navigation — a host supplies those.

The package exists so one renderer stack serves every surface that shows a file: the web app's file and
diff panes, the file-comparison diff tab, and extension tool cards (visualize's file previews,
[[module-ext-visualize]]), so a renderer fix lands everywhere at once.

## Public surface

One barrel, `@thinkrail/resource-renderers` (`src/index.ts`):

- the registry contract — types, `registerResourceRenderer`, `resolveRenderers`, `describeResource`,
  `anchorLabel`, `isPlaceable`, `threadLabel`, `outdatedReason`, `rendererImplementationKey`, and the content
  rules every surface shares: `resourceContent(text, meta, url)` (no metadata yet is provisional text, a
  missing hash is an absent side, a binary side without a byte URL is absent), `diffResourceMeta(original,
  modified)` (a diff is described by its modified side unless that side is absent, and is text only when
  both present sides are) and `PENDING_TEXT_META` — plus `registerBundledResourceRenderers()` (idempotent).
  `diffRendererCapabilities` returns, from a path alone (before content loads), the capabilities of the
  diff renderer it would resolve to — inferring the text/binary split from the path's MIME so known image
  and PDF paths resolve to their layout-less renderers; MIME inference itself stays module-internal. A pane
  uses it to hide scope-wide layout and whitespace controls no file can use;
- the host seam — `ResourceHostProvider`, `ResourcePreferencesProvider`, `ResourceEnvironmentProvider`,
  `ResourceScopeProvider`, `useOptionalResourceHost`, `useResourceScope` and the `ResourceHost`,
  `ResourcePreferences`, `ResourceScope`, `ResourceFileReviewProps`, `ResourceReviewSendProps`,
  `ResourceMarkdown`, `ResourceCodeHost`, `ResourceCodeLanguage`, `ResourceMarkdownProps`,
  `MarkdownRehypePlugins` types;
- `canonicalWorkspacePath` — the package's copy of the app's workspace-relative path identity (`lib`'s
  `projectRelativePath`: POSIX separators, no `.` or empty segments, inner `..` resolved;
  `apps/web/src/panels/pathIdentity.test.ts` keeps the two equal); `describeResource` and `ResourcePreview`
  use it, so a `./`-prefixed tool path reads, refreshes and anchors review comments under the same path the
  host's fs events, the review store and an opened tab use;
- **`ResourcePreview`** — a self-loading file view, or with `before` (another file) a before/after diff of two
  workspace files, with the registry's toggle, the unplaced strip, review commenting and Send review, and
  caller slots (`leading`, `actions`, controlled `rendererId` / `layout`, and an opaque `viewState` it tags
  with the renderer implementation that wrote it, so a renderer switch never restores another renderer's
  state and a caller needs no reset);
- the pieces every surface composes a renderer from, so a file tab, a diff tab, a Changes section and
  `ResourcePreview` run one sequence:
  - `useRendererSelection(resource, intent, rendererId)` — candidates for the environment's phone class, the
    selected renderer, its implementation key (renderer id + phone class) and the placed-thread state;
  - **`usePreloadResourceView()`** — a stable `(resource) => void` that resolves the view renderer for the
    environment's phone class, loads its implementation and runs the module's optional `warm`; it needs both
    providers;
  - the lazy `RendererView` mount and **`GuardedRendererDiff`**, the one diff mount: the expensive-diff notice
    (`diff-too-large` / **Show diff anyway**, per mount, with a caller action slot) until opted in, then the
    lazy diff renderer, virtualized above `VIRTUALIZED_DIFF_LINES` of the caller's `lineCount`
    (`surfaceLineCount`);
  - **`RendererToggles`** — the renderer candidate segments, plus Split/Inline when the caller passes a diff
    `layout`, the renderer supports layout and the viewport is not phone-class (one rule, so a phone never
    shows a layout the diff refuses and a single-file view never shows diff layout);
  - `UnplacedReviewStrip`, `ReviewThreadCard`, `ReviewDraftContext`/`ReviewDraftPersistence`, and
    `createAskAgentRequest`;
- `useScrollViewState` — the one scroll view-state hook (restores a saved offset once the content is tall
  enough, gives way to user input, reports the offset on detach, and adopts a newer saved offset — one a
  sibling instance of the same slot reported on its detach, as the Changes review's Stacked handoff does —
  while its own scroller is still where it was restored to) and `viewStateScrollTop`, its validating
  reader of a reported/saved offset; renderers use them, and so does the web app's Files panel
  (`RememberedScrollArea`), so app and renderers keep one restore rule.

Renderer implementations are never exported; they stay behind each registration's dynamic
`loadView`/`loadDiff`, and the large-diff estimate, the notice and the lazy diff mount stay behind
`GuardedRendererDiff`. The barrel's eager weight is registration metadata plus those pane-side pieces, which
the app's review panes and the chat's visualize card load eagerly anyway (the visualize card added about
20 KiB to the web entry graph, measured with a production build).

## Host seam

A host wraps renderers in `ResourceHostProvider` with one static `ResourceHost` value:

- `markdown` — the component that renders markdown (`ResourceMarkdownProps`); the document preview, rendered
  diff and notebook cells pass their plugins and components through it.
- `code` — the code-highlighting host (`languages` with grammar loaders, `languageId` canonicalization, and
  the code `theme` resolved from CSS variables). Monaco is page-global: the first preload `warm` or
  `MonacoEditor` initializes it from its host's `code` once (`ensureMonaco`, synchronous after the Monaco
  chunk loads), and every later editor reuses that setup. `ensureMonaco` owns the one page-lifetime theme
  watch, so a swap between a preload and the first editor still re-themes, and N open editors cost one
  refresh per swap. A grammar loads on its language's first model or on a warm for its path.
- `bytesUrl(workspaceId, path, oid?)` — the host byte route for images, PDFs and relative markdown assets.
- `openFile(workspaceId, path, { keep? })` and `openComparison(workspaceId, before, path)` — navigation for
  relative document links (preview) and explicit Open-in-tab actions (keep).
- `readFile(workspaceId, path)` and `subscribeFileChanges(workspaceId, onChange)` — `ResourcePreview`'s
  content and live refresh (`null` paths mean "anything may have changed": a truncated batch or a new
  connection, whose missed pushes are never replayed). A read may come back without `meta` from a host that
  predates resource metadata; the preview shows it as provisional text, exactly as the file and diff panes do.
- `FileReview` (a render-prop component: `{ workspaceId, path, kind, sessionId?, children(review) }`) and
  `ReviewSend` — the host's review surface and Send review control; the optional session routes sends. The
  seam is a component, not a hook on the host object: passing hooks around as values breaks React's rules and
  made the React Compiler bail out of the preview; a before/after nests two `FileReview`s.
Build the value once (the app does at module scope). Its functions are memo inputs: `documentComponents`
defines its link and image components per call, so a new `bytesUrl`/`openFile` identity would remount every
link and image in open previews and notebook cells. The reader's line-width preference
(`fileLineWidth` / `fileLineWidthBounded`) arrives separately through `ResourcePreferencesProvider`; only
`MonacoEditor` reads it, so a width change re-renders nothing else. The phone class arrives the same way
through `ResourceEnvironmentProvider` (the registry's `ResourceEnvironment`, `{ mobile }`); only
`ResourcePreview` reads it — panes resolve with their own viewport reading — so a viewport flip re-renders
only the previews that must re-resolve their renderer. A subtree that belongs to one workspace and chat
sets `ResourceScopeProvider` (`{ workspaceId, sessionId? }`, read with `useResourceScope`; the web chat wraps
its transcript list): `ResourcePreview` falls back to its workspace when no `workspaceId` prop is given and
routes review sends to its session. The scope is its own context rather than a host field because a host
spread per chat made every preview's reads and subscriptions restart whenever the chat's actions changed.
`ResourcePreview` depends only on the host's stable `readFile` / `subscribeFileChanges` / `bytesUrl`; it
applies reads in the order it issued them (a newer change event never discards the read in flight, so a
burst of events cannot starve the first load), keeps the loaded file when a re-read returns the same hash —
as the same state object, like a re-read that fails the same way, so React bails out instead of scheduling
a render that would interrupt an unfinished mount below it, such as a large diff's — and keeps the last
good content when a re-read fails, like a file tab, but marked stale: the failure is named above it
(`resource-preview-stale`: `Couldn't refresh <path>: <reason>`), so a moved or deleted file never silently
passes for current. The rendered markdown diff renders both
sides with `renderToStaticMarkup`, outside the React tree, so it reads the markdown component and links in its
own render and passes them to `MarkdownDocument` explicitly — a context read inside a static render would throw
(found by the Changes/rendered-diff e2e during extraction).

`ResourceRenderer.loadView(environment)` receives the same `ResourceEnvironment` (`{ mobile }`) used for
resolution, so the code renderer picks Pierre `File` on phone-class viewports and Monaco otherwise without
reading a viewport global. The loaded module (`ResourceViewModule`, exported from the root) may export
`warm(host, resource)`; a preload calls it after every request, one task after the module resolves, so
the chunk's evaluation and the warm are separate long tasks. It must be cheap and idempotent. Monaco's
`warm` runs `ensureMonaco` and, one task later, starts the highlighter (engine and theme) and the grammar
for the resource's path (an empty path loads no grammar). `usePreloadResourceView` preloads only a
renderer whose `capabilities.preload` is set, which only the code view sets: a host warming every row it
hovers would otherwise load the PDF, notebook or CSV chunk of the row's top candidate.
Once the chunk has loaded, a Monaco mount is
synchronous: no library loader or boot promise stands between the view's commit and the editor.

**One loaded implementation per key, chosen once.** `rendererMount` keeps one component map and the
in-flight load per implementation key (renderer id + phone class), shared by preloads and mounts.
`RendererView` derives that key itself from its `renderer` and `mobile` props, so a mount and a preload
cannot disagree on it. React
`lazy` suspends on its first render even when its promise already resolved, and a shown fallback holds for
at least 300 ms. So a finished load stores the module's component under its key, unless a mount already
stored a `lazy` there, and the first `RendererView` without a stored component stores a `lazy` that reuses
the in-flight load. That choice is stored once and never switched: a lazy and a direct component are
different types, and swapping them would remount a live editor. A lazy made while a load was in flight is
resolved for every later mount, so it does not suspend again. A failed preload, in the load or in `warm`,
logs a warning instead of rejecting. A failed load is forgotten so the next load retries it. A `lazy` that a
mount stored while the load was in flight stays stored and failed, so every re-render of that mount throws
to the pane's error boundary instead of making a fresh `lazy`. React retries a failed render, and an engine
that refetches failed module imports (Chromium 156+) would otherwise loop on the chunk request. The next
load, such as a hover or idle preload, replaces the failed `lazy` with the loaded component.

**Review-draft scratch is read per slot.** A pane that keeps transient authoring across remounts provides
`ReviewDraftContext` with a `ReviewDraftPersistence` (`rendererId`, `read(key)`, `subscribe`, `update(key,
change)`) that stays stable for the section's lifetime; without it every slot is local state.
`useReviewDraftState` reads one slot through `useSyncExternalStore`, so a write re-renders only that slot's
readers, not the renderer surface around them. A composer's text has its own slot next to its selection: the surface
subscribes to the selection, and only `ReviewComposer` subscribes to the text, so a keystroke re-renders the
composer alone instead of the surface and every annotation slot Pierre re-renders with it
(`e2e/perf/changesComposerIsolation.perf.ts` pins this). Text writes land only while the selection that owns
them is current; a new selection, a close or a stamp refresh retires the text; reopening the same selection
keeps it.

## Decisions

- **Markdown is injected, not imported.** The host's markdown (the app's `chat/Markdown`) draws Mermaid
  through `@thinkrail/ext-visualize/web`; importing it would create a package → extension → package cycle
  once extensions render files. The package therefore owns only the props contract; its tests render through
  a test-only react-markdown + GFM helper.
- **Host values are plain and static.** The extraction first resolved markdown and code through lazy loaders
  read with `use`, to keep chat's markdown and the Shiki catalog out of the entry graph. Both were already in
  it — chat imports its markdown statically, and that pulls `lib/highlighter` and `@shikijs/core` — so the
  loaders deferred nothing (rolldown reported the markdown import as ineffective) while costing a suspended
  render on first mount and a loader-identity contract a host could break. Plain values removed both, and the
  web eager graph shrank by about 1.5 kB. Preferences got their own context for the same reason the values are
  static: a host value that changes re-renders every renderer that reads it.
- **Small helpers moved with their only consumer or became primitives.** `stripFrontmatter`, `threadLabel`
  and `outdatedReason` live here; `ToggleSegment` and the one loading placeholder (`SkeletonRows` /
  `LoadingRegion`) became `@thinkrail/ui/toggle-segment` and `@thinkrail/ui/skeleton` because the app uses
  them too. `describeResource` and `ResourcePreview` canonicalize paths through the package's own
  `canonicalWorkspacePath`, because the package cannot import the app's `lib`.
- **Monaco runs its vendored DOMPurify.** `monaco-editor` sanitizes hovers and rendered markdown with its own
  copy under `esm/vs/base/browser/dompurify`, so only a Monaco upgrade changes the sanitizer that runs; the
  `dompurify` it declares is never imported. The vendored copy predates several DOMPurify advisories. The
  exposure is accepted: this read-only reader has no language services, hover providers or decoration
  hover messages, so hover markdown is Monaco's own, and it calls DOMPurify with hooks and
  `RETURN_DOM_FRAGMENT`, never `IN_PLACE` or `SAFE_FOR_TEMPLATES`.
  Monaco 0.57 vendors 3.4.15. The root `overrides.dompurify` pin only keeps the declared copy on Mermaid's
  patched version (Mermaid does import it); it is not a Monaco fix. Re-check the vendored banner on every
  Monaco upgrade.

## Boundary

- **Allowed deps:** `@thinkrail/contracts` (types), `@thinkrail/locales` (the `MessageKey` type and
  `./react` for its UI strings — `useT`, `<T>`, `localeOf`), `@thinkrail/ui` primitives, React, and the renderer
  engines (`monaco-editor`, `@shikijs/monaco`, `shiki`, `@pierre/diffs`, `pdfjs-dist`,
  `react-markdown`, `rehype-raw`, `rehype-sanitize`, `diff`, `jsondiffpatch`, `react-virtuoso`,
  `node-htmldiff`).
- **Forbidden:** the web app (store, transport, panels, chat, shell, lib, themes), extensions, the server, and
  pi packages. `scripts/check-module-boundaries.ts` enforces it; only `apps/web` consumes the package today.
- UI text follows [[architecture]] Decision 23: renderer chrome renders through `useT()`'s translator
  (`viewer.*` keys) and `check:i18n` scans `packages/resource-renderers/src` like the app. A renderer's
  `labelKey` is a catalog key, never translated text: registration happens once at module load, so the
  view-toggle, candidate pickers and unplaced strip translate it at render with their own translator.
- Styling follows the app's token rules: the Tailwind `@source`, the colour/spacing/typography guards and the
  React Compiler census all scan `packages/resource-renderers/src`.

## Registry and review-surface contract

Own the engine-neutral resource description, renderer registry, and review-surface contract used by file
and diff panes. Selection is metadata-driven: matching renderers are filtered by intent and phone support,
ranked, and followed by the required text or byte fallback. MIME matching uses the same extension-derived
fallback as resource description when host MIME metadata is absent. The resulting ordered list is both
dispatch policy and the pane's view-toggle grammar. Renderer capabilities also state whether the selected
surface supports copying its modified source, split/unified layout, and ignore-whitespace recomputation; the
pane exposes only those applicable controls. `preload` marks a view worth loading before its first mount
(only the code view sets it). `boundedDiff: "always"` marks a diff renderer that manages its
own viewport (virtualized table, paged PDF, sandboxed HTML frame) and therefore needs a bounded height;
`"large"` marks one that lays out naturally but virtualizes once bounded, so a host bounds it when the diff
is large; a host passes `virtualize` only for a diff large enough to need it. Every other diff lays out at its natural height, which is what lets the continuous Changes review stack sections
in one scroll. `HunkActions.triage` is optional: a surface that tracks kept hunks supplies the kept keys,
a setter, and a sink for the renderer's hunk content keys; a renderer without it shows no Keep control.

`ResourceContent` keeps text, retrievable bytes, and an absent diff side distinct. In particular, absence
is never represented by a byte payload without a URL. `SurfaceReview` carries authoritative anchors; a
renderer only projects selectors into geometry. `isPlaceable` answers whether at least one positioned
selector has a geometry the renderer advertises for the requested view or diff intent, while `anchorLabel`
is the shared compact reference. `ResourceDiffProps.originalResource` describes the original side when it is
a different file (a file comparison); renderers that resolve relative assets or links from the document
path — the rendered markdown diff — use it for the original side, and the visual diffs title that side with
it; absent, both sides share `resource`. A diff renderer may report the thread ids it actually placed through
`ResourceViewProps.onPlacedThreadIds` or `ResourceDiffProps.onPlacedThreadIds`; the pane treats
capability-matching ids omitted from that set as unplaced too, covering renderer-local geometry such as a
removed JSON pointer, deleted table cell, or collapsed context. A virtualized paged renderer reports against
known page-count geometry rather than transient canvas residency, so releasing an off-screen page does not
make its thread unplaced. A renderer with no anchor capability for its intent may ignore its review prop; the
pane keeps those threads in its unplaced strip instead.

`HunkActions` is the mutation boundary between a diff engine and its pane. A renderer reports only the
engine-neutral original/modified `LineSpan` pair it computed: `revert` applies that one block,
`revertFile` applies the file target, and `askAgent` returns the `AnchorDraft` plus initial composer text
that the renderer places on the modified side. `agentWorking` is presentation-only and never disables the
CAS-protected actions. The pane owns wire calls, scope and expectation hashes, undo receipts, stale-view
refresh, and error UI. An immutable scope omits `hunkActions`; renderers must then omit every mutation
control rather than emulate one.

Registration owns no content or tab state. Panes own transport URLs, review integration, selected renderer,
and opaque per-tab view state. `anchorLabel` prefers a structural locator over its mandatory text fallback:
`table-cell` is `R<row>C<column>`, `json-pointer` is the pointer itself, and unknown schemes retain
`<scheme> <ref>`; `ipynb-cell` is `cell <n>` for legacy `index:<zero-based>` refs and `cell <id>` for
stable ids, with an optional renderer-supplied id-to-ordinal map producing the local `cell <ordinal>` label.
Paged regions are `p<page> region`; unpaged regions, lines, and files keep their existing forms. Registration
carries only dispatch, geometry, viewport, and concrete diff-control capabilities; it has no unenforced
provenance or execution-policy metadata. Sandboxing belongs to each renderer implementation.

**Wide rewrites wait behind a notice.** Source diffs run on the main thread, and that cost tracks the number
of changed lines, not the file size: a 10 MB all-added file diffs in ~0.1 s while ~10k changed lines take over
20 s. Before mounting a diff renderer, `GuardedRendererDiff` estimates the changed lines (`largeDiff`: the
linear multiset difference of the two sides' lines). Above `LARGE_DIFF_CHANGED_LINES` (2000, about a second of
diffing), or when an order-sensitive check cannot finish within 50 ms / 2000 edits, it shows `diff-too-large`
with **Show diff anyway** (per mount) and the caller's actions. A one-sided diff (added or deleted file) is
never guarded: it costs no diffing. The bounded check closes the multiset estimate's blind spot for reordered
lines. The notice says "This diff is too expensive to show automatically" without a line count; the guard
answers only whether automatic rendering should wait. Every diff surface mounts through it, so the app's diff
tabs and Changes sections, comparison tabs and chat cards cannot disagree.
The first diff of a page mounts through a Suspense retry (the lazy renderer), which React renders
interruptibly and never expires: any unrelated update during it (a watcher nudge, a file re-read) discards the
unfinished mount with its `useMemo` results, and recomputing per restart kept a Show-anyway diff on a skeleton
for as long as the workspace kept changing. `PierreDiff` therefore takes its parse and change blocks from a
content-keyed module cache (`diffCache`) that a restarted render reuses, and computes change blocks only for a
surface with hunk actions, so a read-only preview diffs once. Each of its two tables (parses, change blocks;
they hold the same texts) is bounded by the text its entries retain — 4 Mi characters across both sides,
about twenty full rewrites at the notice threshold (2000 changed lines of ~100 characters) — and by 64
entries, more than one render of a Changes viewport mounts, so releasing every section at once cannot cycle
it; the newest entry always stays however large, so an opted-in giant diff survives its own restarts. The
trade-off: being module-level, it keeps up to that text (or the one larger newest diff) plus Pierre's parse
of it alive after its surfaces unmount, and surfaces that together exceed the budget within one render
recompute on every restart.


## Bundled renderers

Bundled candidates are registered once by `registerBundledResourceRenderers()`: `thinkrail/code` renders
every source diff with Pierre `FileDiff` and supports copy, layout, and whitespace controls;
`thinkrail/markdown` supplies `RenderedDiff`, and `thinkrail/binary` reports both sides' byte sizes. Rich
renderers omit those controls, except CSV, JSON, and notebook diffs support modified-source copy.
`thinkrail/lfs` claims the host's `application/vnd.git-lfs` text (a file that *is* a Git LFS pointer,
whatever its extension) above the code renderer and shows a card — "Stored in Git LFS", size, object id,
`git lfs pull` hint — in the view and one card per side in the diff, because three lines of pointer
protocol in a Monaco editor explain nothing about why a `.png` has no image; Source stays one toggle
away, and the renderer places no anchors, so a pointer's threads live in the unplaced strip.
`RenderedDiff` keeps its worker-isolated htmldiff merge,
loading/error states, and token styling (a text change keeps the previous merge on screen until the next one
arrives, so a live refresh neither flashes the loading placeholder nor remounts the document; finished
merges live in a module-level LRU (`renderedDiffMerges`) keyed by a hash and the lengths of both rendered
sides and bounded like `diffCache` — 16 entries and 4 Mi retained characters — so a remount of an unchanged
diff renders synchronously without the placeholder or a replayed reveal fade, and a cache hit becomes the
mounted document that the next text change keeps on screen), but advertises no diff anchors: both sides' threads stay in the
pane's unplaced strip, **Show in Source** selects the code renderer, and diff authoring is available only
in Source. It is selected by registry match rather than a path branch in the pane. Scopes whose modified
side is historical receive no review surface or mutation actions.

**The rendered diff focuses on its changes the way Pierre does.** The merged document is parsed once
and a prose-root block is *changed* when it is or contains `ins`, `del`, or a `[data-diff-node]`
element, **or** when its exact rendered HTML differs from the before unit it aligns with
(`changedUnits`). Alignment is positional: the before and merged unit sequences (blocks, then each
list's items) are matched one-to-one by an LCS over their attribute-stripped HTML (`shapeKey`), so an
identical twin elsewhere in the document cannot vouch for a block, swapping `open` between two
otherwise identical `<details>` flags both, and a unit with no aligned counterpart stays visible. The
second clause exists because htmldiff keys ordinary tags by tag name alone and emits the *after*
tokens for equal runs: a ticked task checkbox, `<details>` → `<details open>`, a list's `start`, or
an image's `alt` never earn a mark, so without it they would collapse as "unchanged" and the empty
notice would claim an identical preview. Such a block is kept visible in its after state (unmarked,
since the merge has nothing to highlight). Runs of unchanged
blocks collapse with git hunk semantics (`renderedDiffFocus.focusSegments`):
`FOCUS_CONTEXT_BLOCKS` (2) blocks stay visible on each side of a change, a leading or trailing run keeps
context only on the side that touches one, and a run of a single block is never hidden, because an
expander that replaces one paragraph saves nothing and costs a click. The same rule applies one level
down to the items of a changed `ul`/`ol` when at least one item changed — a markdown spec routinely
carries a thirty-bullet list with one edited bullet — while a list whose only difference is its own
attributes, and tables, quotes, and nested lists, render whole; ordered items keep their number
(`start` and an explicit `value` are read with HTML's integer-parsing rules, so the invalid values
React leaves in the DOM — `start=""`, `value=""` — fall back to `1` / the running count exactly as
the browser does; a `value` wins, the rest count on) so hiding items never renumbers the rest.
Each hidden run is one `rendered-diff-collapsed` button naming the count and, for block runs, the last
heading it hides (the section the visible content below it belongs to — the analogue of Pierre's
line-info separators).
Clicking expands the run in place, one-way; expansion is component-local and positional, so a live
refresh keeps an expansion whose run still starts at the same position and resets the rest. Nothing
offers the whole merged document at once: Source and the file preview already do. A merge in which no
block changed — front matter is stripped before rendering, and whitespace or HTML comments don't
render — shows the `rendered-diff-empty` notice pointing at Source and collapses the document to a
single expander rather than presenting an unmarked full document as a diff. Visible blocks are
re-created from the parsed elements (tag, attributes, `innerHTML`), never wrapped, so the DOM the
prose styles target is unchanged; the boolean attributes the sanitizer lets through (`details[open]`, a
standalone checkbox's `checked`/`disabled`) are mapped to `true` because React drops an empty-string
boolean.

`thinkrail/image` renders host-backed byte URLs with fit, natural-size, button/wheel zoom, intrinsic
dimensions, and byte size, always on the `.media-backdrop` transparency checkerboard (the view's image
and both diff frames; the difference blend keeps a flat canvas so the checker cannot leak into the
subtraction), because on a solid dark canvas a dark logo on a transparent PNG is indistinguishable from
an image that failed to load. A drag over the rendered intrinsic box produces one normalized `region`
selector; placed threads project that selector back to outlined rectangles and numbered markers, with
cards below the image. Its diff defaults to 2-up and also offers swipe, onion-skin, and difference-blend
modes. Two-up anchors directly to the side drawn on; overlaid modes expose the active old/new anchor space
explicitly, so base and worktree coordinates are never translated. An absent side is a labelled empty
frame. Image zoom, rendered intrinsic aspect bounds, region rectangles, swipe clipping/divider position,
and onion opacity are measured geometry and therefore the bounded exception to the no-inline-style rule:
those values alone are inline,
while every colour, border, spacing, and control skin remains a token utility.

`thinkrail/svg` contains the vector in its pane in both dimensions (≤ 960 px wide), measured in a layout
effect so a drag's first geometry is already final. It is the higher-ranked SVG candidate while Source remains available through
`thinkrail/code`. Its `sandbox=""` iframe receives a minimal `srcdoc` document whose only image is a
percent-encoded `data:image/svg+xml` URL; SVG source never enters the document's HTML stream. The frame
has no script or same-origin capability and a CSP of `default-src 'none'; img-src data:; style-src
'unsafe-inline'`, so SVG scripts and external references remain inert. The document receives only
resolved workspace/content background and foreground semantic token values and is rebuilt via
`onThemeSwap` from `@thinkrail/ui/theme`. A drag over the frame authors the same normalized `region`
selector a raster image does, measured against the intrinsic size parsed from the root's
`width`/`height`/`viewBox` (the frame is sized to that aspect, so the contained rectangle is the frame).
It never degrades to a whole-file draft: an earlier revision did (`selectors: []`, label `file`, pending
a source-span mapping), and a dragged rectangle that reached the agent as "the whole file" read as lost
coordinates. SVG element source spans are still not mapped, so the anchor is geometry, not a line range;
the fractions are of the SVG's root viewport, and the send package tells the agent to invert the
viewport-to-viewBox transform (viewBox origin plus `preserveAspectRatio`) to find the elements under
them. Its diff uses the same four visual modes and two anchor spaces as raster images; each side's
overlays project through its own object-contain rectangle, and only measured aspect bounds plus
swipe/divider/opacity overlay geometry use inline values.

`thinkrail/csv` parses CSV/TSV locally with an RFC-4180 state machine, including escaped quotes, CRLF, and
quoted fields spanning source lines. The delimiter is **inferred from the shape of the first twenty
non-empty records** (`sniffDelimiter`, BOM ignored): a candidate among `,` `;` `\t` `|` qualifies only
if it splits every sampled record into the same number of fields, at least two; comma wins whenever it
qualifies, otherwise the single widest qualifier, otherwise comma — so a header value that happens to
contain semicolons never reclassifies a comma file, while a locale export of `id;name;score` is a table
and not one column; `.tsv` is always tab. A diff samples the modified side first and falls back to the
original, so both sides parse with one delimiter. The view keeps the header fixed and virtualizes data rows with
`react-virtuoso`. A selected cell or shift-extended rectangle emits the selected rows' raw-file
`lineRange` plus `structural { scheme: "table-cell", ref: "<row>:<column>" }`, with header row zero; a
missing cell, or a coordinate whose row no longer intersects the host-reanchored line range, is omitted
from actual placement rather than guessed. The unified diff aligns complete raw-row keys with
`diffArrays`, pairs equal-length remove/add runs as changed rows, and highlights only differing cells;
unmatched rows use success/error subtle surfaces. Diff selections use modified source lines except removed
rows, which remain in the base anchor space.

`thinkrail/json` matches `*.json` and `*.jsonc` only. Its scanner is **JSONC-tolerant by design** —
`tsconfig.json`, `.vscode/*.json` and most editor settings files carry comments and trailing commas,
and a tree that refused them would send exactly those files to Source — but it is honest about it:
the document records the `dialect` it needed, and a `.json` file that only parsed as JSONC shows a
`json-dialect` notice above the tree (a `.jsonc` file does not, because there it is the point); a
file that is not even JSONC renders an explicit `json-invalid` notice pointing to Source instead of a
blank pane, in both the view and the diff. The scanner builds the parsed value and an RFC-6901
pointer-to-source-line index in one pass; duplicate object keys resolve to the last occurrence,
matching JSON value semantics. Selecting a non-root node emits
its mandatory `lineRange` plus `structural { scheme: "json-pointer", ref }`; a pointer absent after an edit,
or one now naming a node outside the host-reanchored line range, is reported unplaced. The collapsible
unified diff comes from a `jsondiffpatch` instance with move detection
and stable object hashes, tinting added/removed/changed/moved nodes and showing primitive replacements as
old → new. Removed nodes and comments stay on `review.base` with base scanner lines; all other selections
use the modified document and `review.worktree`. Invalid source renders no tree, leaving Source as the
alternate candidate.

`thinkrail/notebook` accepts nbformat-4 JSON and reuses the tolerant positional JSON scanner to bind every
rendered cell to its raw cell-object line range. Nbformat 4.5 ids are the `ipynb-cell` structural ref;
older notebooks use `index:<zero-based>`. Markdown cells use the shared Markdown parser without raw HTML.
Its notebook component map (`notebookMarkdownComponents(resource)`, built per notebook because image
resolution is relative to the notebook's own path, as in Jupyter) permits base64 PNG/JPEG/GIF/WebP/AVIF
images in the app document, routes SVG data images through the empty-sandbox `NotebookFrame`, loads
**relative** images from the host `/files` route through the same injected byte-URL composer the
markdown preview uses (a traversal above the worktree is inert text, never a request), and renders
links plus every remote image URL as inert text — a notebook's `![plot](figures/x.png)` is repository
content, a third-party URL is not. Notebook language metadata must resolve through the shared Shiki catalog; missing
metadata defaults to Python and unknown values render as plain text. ANSI is removed from stream and error
output. MIME bundles choose image (PNG, JPEG, GIF, SVG), HTML, JSON, then plain text. SVG output stays a
data image inside the inert frame document.
HTML output uses the same sanitized empty-capability document as the HTML renderer. Cell review emits both
the raw line range and structural ref, keeps cards below the resolved cell, reports only actual placements,
and hash-stamps an open composer. Diffs align ids first and exact normalized source second. Remaining runs
are aligned in order by bounded line-token similarity; no character-level all-pairs diff is used. Changed
source uses one provider-backed unified Pierre cell diff, image output reuses visual comparison modes, text
output uses Pierre, and HTML/JSON output stays side-by-side. Original cell selectors remain in `review.base`;
neither side is translated.

`thinkrail/pdf` matches byte PDFs and lazy-loads both pdf.js and its Vite-emitted worker. Placement is not
reported until page-count metadata is known. A page-region thread is placeable exactly when its one-based
page exists, independent of whether that page currently owns a canvas. A focused page is forced into the
render window and focus is consumed only after its region card mounts. The render window is the visible
pages plus two pages on each side. Work leaving it is cancelled; canvases and bitmaps are released, and
diff object URLs are revoked. Composer identity uses document identity plus page, never zoom. The toolbar's
current page is the first visible page (the navigation target until any page reports visibility), so it
follows scrolling as well as navigation; that page and the zoom are written to tab view state when the
view unmounts, like the other scroll-restoring renderers. PDF diffs use one synchronized page sequence: each page pair
starts in 2-up and can switch among the shared swipe, onion, and difference modes, with an absent side
represented by an explicit empty page frame.

`thinkrail/html` parses source into a document before previewing it in an empty-capability `sandbox=""`
iframe. The sanitizer removes active, navigational, embedding, and form elements; strips event handlers and
non-`data:` resource URLs; and turns anchors into inert text-bearing elements. Styles remain. Notebook HTML
output uses this same sanitizer. The injected CSP is exactly `default-src 'none'; img-src data: blob:;
style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src
'none'; child-src 'none'`. The diff is the shared visual frame constrained to 2-up sandboxed documents only.
It advertises no anchor geometry, so HTML threads remain in the pane-owned unplaced strip and Source is the
only authoring candidate. View and diff share a **preview width** switch in the notice bar — Desktop 1280 /
Tablet 768 / Phone 390 / Fill, default Desktop, persisted as `{ viewport }` view state and adopted whenever the
caller's view state changes (`useHtmlViewport`, so a chat card follows a width chosen in its full screen): the frame renders at
the design width and is CSS-scaled down to its box (never up), keeping its own vertical scroll, so a narrow
pane, a 2-up half or a chat card shows the true layout shrunk rather than an accidental mobile reflow; Fill
is the old reflow. Scaling is pure geometry on the wrapper — the iframe keeps `sandbox=""` and nothing
measures the document (no `allow-same-origin`); the wrapper's box is measured in a layout effect (the package's
one `useElementSize`, shared with the SVG view and the region surfaces), so the first paint is already fitted
instead of reflowing the document at the pane width for a frame. The sanitizer also strips form controls, so mockups draw
buttons and inputs with styled elements; spot (region) comments on HTML are not offered yet.

Pierre parses the two complete text sides (`absent` → `null`) with the current ignore-whitespace value,
uses the `thinkrail` CSS-variable Shiki theme, word-level inline changes, collapsed unchanged regions with
line-info hunk separators, and split/unified layout; phone-class viewports force unified and hide the
Split/Inline segments, so no control promises a layout the viewport refuses. The collapse threshold
(`COLLAPSED_CONTEXT_THRESHOLD`, 3 lines) is git's own default hunk context (`-U3`), so what Pierre
keeps visible around a change is what a reviewer already expects from `git diff`, and the same number
feeds `renderedDiffLineNumbers`, which decides whether a thread's end line is on screen or parked in the
unplaced strip — one constant, so the two can never disagree. The focus reveal (`usePierreFocus`)
installs a subtree `MutationObserver` plus a `ResizeObserver` only while a focus request is pending
and disconnects both the moment the card is revealed; it is not a standing listener, so Pierre
re-rendering on every annotation change costs nothing once focus has settled. A diff whose
two sides are identical (a file that left the change set after an out-of-band commit) shows an explicit
`diff-empty` notice above Pierre's surface instead of a blank pane. The lazy Pierre file/diff modules
mount `PierreProvider` only when their surface renders; it hands Pierre's `WorkerPoolContext` the module
singleton (`getOrCreateWorkerPoolSingleton`, four module workers from `@pierre/diffs/worker/worker.js`)
and **never terminates it**: the pool is created the first time any code surface renders and then lives
for the page. Pierre's own provider tears the pool down the moment its last instance unmounts, and the
virtualised review list reaches that moment on every jump or fast scroll into files that have not
loaded yet; each rebuild spawned the workers again, re-fetched the WASM, theme and grammars, dropped
every highlighted AST, and painted nothing until initialised — the stacked view's "loading forever".
Four idle workers are the price of never paying that again; the list mounts a handful of sections at a
time, so four keep up. The pool's highlight cache is keyed by the diff's `cacheKey`, which Pierre derives
only when both sides carry one; `PierreDiff` keys a one-sided (added or deleted) diff itself from its
present side's hash, so a remount — a Stacked/One-file switch, or a section scrolling back in — paints
highlighted on its first frame instead of plain text followed by a colour pop. The phone code-file implementation is Pierre `File` with the same theme and
review grammar; desktop files alone load Monaco.

**Pierre surfaces are virtualized.** Unvirtualized Pierre puts every line in the DOM (≈400k nodes for a
100k-line file), which WebKit — the desktop shell's engine — cannot style or lay out, hanging the app.
`pierreVirtualizer.ts` owns one `PierreVirtualizer` (a core `Virtualizer` subclass) per surface,
provided through `VirtualizerContext` so `FileDiff`/`File` build their virtualized instances, and set up
from the same ref callback as `useScrollViewState` so scroll restoration keeps working. The scroller's
first child is the content container and must give the Pierre element a non-zero height from the first
frame (`flex-1` in a `min-h-full` column): Pierre's scroll anchor treats a zero-height file as lying
above the viewport and jumps to its end once the height lands. The scroller opts out of browser scroll
anchoring (`overflow-anchor: none`, as Pierre's own `CodeView` does) because Pierre corrects scroll
itself. Annotation children stay in the light DOM but lay out only inside the render window, so the
focus reveal first asks the virtualizer to center the thread's end line (`revealLine`, through the
connected instance's `getLinePosition`) and then centers the card once it renders. A freshly opened
diff composer gets the same treatment — Ask agent anchors it at the hunk's end line, which for a tall
hunk lies outside the window — and `ReviewComposer` defers its initial focus until its textarea has a
box, since focusing an unrendered element is a silent no-op. Restored composers keep the restored
scroll position instead.
A virtualizer windows only against a real scroller: a stacked Changes section at natural height is as
tall as its content, so its virtualizer "sees" every line and renders them all (≈72k rows for a
100k-line added file, freezing the app once it lands). The code renderer therefore declares
`boundedDiff: "large"`, and a stacked section above `VIRTUALIZED_DIFF_LINES` (1000, by the larger
text side's line count, including unchanged context) gets the same bounded `60vh` viewport as
`"always"` renderers and owns its scroller. Counting source lines keeps expansions virtualized even
when a large file has only a small edit, and covers untracked files without git's missing counts.
The same threshold gates virtualization in every host: `GuardedRendererDiff` passes `virtualize` only
above it, and below it `PierreDiff` withholds its virtualizer so the plain `FileDiff` renders every
row, as before virtualization. Virtualizing small diffs bought nothing and cost two failures. A
virtualized instance's hydrate measures its offset (forcing layout) while its container is still
empty; in the stacked list, whose end sits at maximum scroll so the last header can reach the top,
that collapsed layout clamps `scrollTop`, and Virtuoso's size correction compounds the jump until the
reviewed section leaves the render window. And `@pierre/diffs` 1.5.1's virtualized in-place column
re-render can drop annotation rows that the instance still records, leaving a just-opened composer
slotted nowhere until something forces a `rerender()`. Large diffs still carry that annotation risk.

**Virtualized scrolling is tuned for chunk cost.** Pierre lays each code column out as a subgrid with
one item per row, so every render-window shift relays out the whole rendered grid, and the cost of a
shift tracks the rows inserted, not the rows kept. Split layout pays it twice whenever the new rows
carry an annotation (hunk toolbars, threads): Pierre's `ResizeManager` pairs each annotation row across
both columns with a forced `getBoundingClientRect` and then syncs the pair's
`--diffs-annotation-min-height`, forcing a second layout. With Pierre's 50-line chunks that was a
~90 ms long task per shift under the Chromium profiler and ~80–95 ms hitches in WebKit.
`usePierreVirtualizer` therefore passes `hunkLineCount: 5` and a 400 px overscroll (Pierre defaults: 50
lines, 1000 px), measured with wheel flings over a 6k-line, 150-hunk diff: inline and added-file
scrolling drop from 12–34 to 2–3 dropped frames in WebKit, and the worst split hitch roughly halves
(~45 ms). Split scrolling over dense hunk toolbars still drops frames in WebKit; without the toolbars
it is smooth, and `overflow: "wrap"` (which skips the pairing because both sides share grid rows) helps
moderate scrolling but not flings. The virtualizer's `lineHeight` metric is the real row height:
`.pierre-code-surface` rounds `--diffs-line-height` to whole pixels (`s11` × `default` = 14 px,
matching Monaco's rounding), and `codeLineHeight()` derives the same number from the tokens. Against
Pierre's 20 px default estimate the scroll height of a 20k-line file started ~40% too tall and shrank
while scrolling as rows were measured. Rejected after measurement: mirroring an invisible spacer onto
the opposite split column (it cut paint area but not dropped frames in either engine) and a larger
overscroll (about twice the dropped split frames at 5-line chunks, and no fewer blank frames in fast
flings).

**`PierreScroller` keeps the compositor from showing unpainted rows.** WebKit (the desktop shell)
scrolls overflow off the main thread: a scrollbar drag in a 20k-line file jumps ~2,600 px per step,
and each step showed one fully blank frame before the main thread painted the new window. No
overscroll covers that, and painting Pierre's spacer elements like rows did not help: the blank was
unrasterized space, not the spacers. The scroller therefore keeps native scrolling (scrollbar, wheel,
keys, momentum, autoscroll) but holds a sizer measured to the content height, a `sticky` viewport
clipped to the scroller's height, and the content translated by `-scrollTop` on the main thread.
Off-thread scrolling moves only the sizer, so the pinned viewport keeps showing the last painted rows
until the main thread moves the content in the same frame it renders the window — a fast drag lags,
never blanks. Pierre corrects the scroll position inside its rAF pass and `useScrollViewState`
restores it from a ResizeObserver, both after that frame's scroll event, so the scroller's own
`scrollTo` and `scrollTop` re-sync the transform synchronously; otherwise Pierre would measure rows
against a stale offset. Natural-height stacked sections run the same structure without scrolling:
the viewport's height is read back from the scroller after the sizer is set, so it never feeds the
content's own height.

- **Rendered markdown navigates.** In the preview, links + images resolve against the file's own path
  (via `markdownLinks`, passed as the `a`/`img` renderers): a **relative link** opens the target file in
  the **preview** tab through the shared **`openFileInTab`** (the same flow `FileTree` uses) — following a
  link is browsing, so the slot is reused rather than promoting the source doc the way VS Code does; an
  accepted file target is a button styled as document-link text, never an anchor with a raw relative
  `href`, because that URL is not a ThinkRail route and native navigation would escape to the Main page;
  URL pathnames are decoded once and both path-separator forms are normalized before resolution, while
  malformed encoding and traversal above the worktree root produce an inert control instead of opening the
  wrong file; the slot is the slot, whatever
  the open came from — an **in-doc `#` link**
  scrolls the preview (headings carry slug ids from the in-repo `remarkHeadingIds` transform), an
  **external** link opens a new tab, and a **relative image** rewrites to the host **`/files/…`** route
  (through `resourcePane.resourceBytesUrl`, injected into `documentComponents` so the markdown layer never
  reaches for the transport itself). A cross-file link's `#fragment` is not yet followed (opens the
  file only).
- **Document markdown renders sanitized raw HTML; chat markdown does not.** READMEs place logos and
  banners with `<p align="center"><img src width>`, float images with `<img align="right">`, fold
  sections in `<details>`, and ship theme-aware logos as `<picture><source media srcset>`; shown as
  literal tags, those documents lose exactly their most visible content. `markdownHtml.documentRehypePlugins`
  runs `rehype-raw` and then `rehype-sanitize` on GitHub's `defaultSchema` with three deltas: the alert
  element the in-repo remark transform emits (`mdalert` + `variant`) is allowed and `<source>` keeps
  `srcset`/`media`/`type`/`sizes`. GitHub's **`user-content-` clobber prefix stays on** every `id`/`name`
  (a document must not be able to mint `window.MonacoEnvironment` or shadow a global by naming an
  element after it), so in-document `#slug` links resolve through `scrollToAnchor`, which tries the
  prefixed id first and the bare slug second. Everything active or stylistic — `script`, `iframe`,
  `style`, event handlers, inline `style`, `javascript:` URLs — is dropped, and `data:` images with it
  (the schema's `src` protocols are http/https/relative). Raw `<img>`/`<source>` go through the same
  relative-URL rewrite as markdown images, so a README logo loads from the worktree; `srcset` is parsed
  with the HTML candidate grammar (`srcsetCandidates`: commas inside URLs, descriptor parentheses) and,
  because neither the sanitizer nor react-markdown protocol-checks `srcset`, every candidate is
  re-admitted only as a worktree URL or an `http(s)`/protocol-relative one — `javascript:`/`data:`
  candidates are dropped, as is a bare `src` of those kinds; `width`/`height` survive, and
  `align="left|right"` maps to a float utility rather than a presentational attribute. The source-line
  stamps for commenting are added **after** sanitizing, so the sanitizer can never strip them. The chat
  `Markdown` primitive is untouched: model output is not a document the user authored.
- **Desktop file source wraps at the synchronized file column.** `MonacoEditor` uses the reader preference
  `fileLineWidth` as `wordWrapColumn` (40–240, default 120). The independent `fileLineWidthBounded` default maps to Monaco
  `wordWrap: "bounded"`, wrapping sooner at the mounted file pane; off maps to `"wordWrapColumn"`, preserving
  the selected column with horizontal scrolling in a narrower pane. Broadcast changes update a mounted
  desktop file editor. Pierre diffs and phone files own horizontal overflow and do not consume this Monaco
  preference. Rendered Markdown and rendered Markdown diffs retain their separate ~78ch reading measure.
  The React Compiler memoizes `MonacoEditor`'s options on width, bounded and path, and the editor calls
  `updateOptions` only when that object changes; the typography and spacing tokens the options read are
  static generated CSS (themes set only colours).
- **The desktop Monaco surface is a reader, not a language workstation.** Its file-only options keep the
  configured wrapping, generated code typography, minimap/overview-ruler removal and 6px shadowless scrollbar,
  and add read-only messaging, the path as its accessible label, an 8px top inset, three-character line-number
  gutter, full active-line paint, smooth scrolling, active bracket-pair + indentation guides, single-file
  occurrence highlighting, and ambiguous-Unicode suppression. Opaque `viewState` is restored only after its
  editor-state shape is validated and is saved on unmount, so tab switches round-trip scroll and folding.
  A review focus that arrives with the mount jumps to its line (`revealLineNow`, an immediate scroll): a
  smooth scroll started before the editor's first layout can stop short, and the handled focus is not
  retried, so the card stayed off screen. A focus on a mounted editor still scrolls smoothly.
  Monaco is imported from `editor.api` with only the reading contributions (find, folding, bracket matching,
  context menu/copy, links, hover, word highlighting, sticky scroll, go-to-line/command palette, read-only
  messaging and Unicode highlighting); keeping word highlighting preserves F7. Each contribution loads through
  its typed `monaco-editor/features/<name>/register.js` entry, because Monaco's `exports` map closes the deep
  `esm/vs/...` paths. The editor core loads `coreCommands` itself. `codicon-modifiers.css` is not exported, so
  codicon spin animations (only hover loading icons here) stay static. The TS/JS/JSON/CSS/HTML
  language-service contributions and their workers are absent, so this viewer emits no language-service
  diagnostics by construction. Each editor mount owns its model: the model id is a per-mount `useId` scope
  ahead of the path, so the same file on screen twice (a chat card and its full screen, a card and the
  file's tab) never shares a model that one unmount disposes under the other.
- **`MonacoEditor` mounts Monaco itself.** A layout effect creates the editor and its model in the commit
  that mounts the view, with no loading state, then restores the view state and attaches review commenting
  (review attaches only at mount). Its layout cleanup saves the view state before it disposes the editor
  and the model, in that order. A path change on a live editor swaps the model in place, and the language
  follows the path, because `RendererView` is keyed by implementation, not path. New text calls `setValue`
  only when it differs from the text last applied: the editor is read-only, so the last applied text is
  the model's text and reading it back (`getValue()`) would only cost a full copy. The model and options
  effects skip their first run, because the mount just created the editor with exactly those inputs. The
  editor lives in a layout effect, so a re-suspend inside the view's Suspense boundary disposes it (and any
  open review composer); nothing re-suspends there today, because each `RendererView` has its own boundary
  and its loaded component is cached.
  A review focus in the mount commit reveals its line with `ScrollType.Immediate`: a smooth reveal issued
  before the editor's first frame never lands (found by the far-off worktree comment e2e). A later focus on
  a live editor scrolls smoothly.
- **Code surfaces re-theme from generic tokens, resiliently.** `monacoSetup` owns the sole `EDITOR_THEME`:
  `createFileEditor` applies it and the theme refresh defines it.
  Themes own one TextMate scope definition: chat uses its live CSS-variable form, while Monaco resolves that
  same definition plus its complete editor/widget/menu/input colour map to hex and defines the Monaco theme from
  it directly. Token colours come from `shikiTokens.ts`, a Monaco-free owner of one Shiki highlighter, its
  per-language grammar loads and the colour→scope map. Its curated language catalog is shared with the chat
  highlighter and extended for the desktop file formats; missing Monaco language ids are registered with their
  file associations, then each catalog id gets a `registerTokensProviderFactory` entry. A swap loads the
  highlighter theme under the other of two names and rebuilds the scope map from the same converted Monaco rules it
  defines, redefines Monaco, and selects `EDITOR_THEME`. The normal/high-contrast base comes from manifest
  appearance/contrast metadata—never a known id—and remains inherited for specialist colours outside the
  explicit map. Reads pass through `lib.cssColorToHex`; an absent or unparseable token is
  omitted so the selected base palette wins rather than crashing the panel. Pierre's one registered
  `thinkrail` CSS-variable Shiki theme emits variable references instead of catalog colours; inherited
  `--diffs-*` properties map foreground/syntax to `--code-*`, canvases to the workspace/content roles, and
  addition/deletion paint to feedback roles, so a theme swap needs no re-highlight. `TerminalInstance`
  similarly rebuilds from the complete 16-slot ANSI variable set. Monaco and xterm consume the nullable
  editor selection-foreground override when provided.
- **Monaco loads one grammar per language and tokenizes on Oniguruma WASM.** Compiling all 35 catalog
  grammars up front was a 210-250 ms main-thread task (about 870 ms at 4x CPU) before the first coloured
  line, and the JS regex engine tokenized about 4.5x slower than Oniguruma (a 2,861-line TS file: about
  1,715 ms against 380 ms). The factory's `create()` loads the grammar when Monaco first meets a model of
  that language; the `languageForPath` probe model starts it before the editor mounts. Concurrent
  requests share one load, and an unknown id stays plain. Monaco asks a language's factory for a provider
  only once, so a failed load answers plain text and marks the language missing; a failed highlighter or
  engine start is not cached, so a later request retries it. The next model of that language whose load
  succeeds installs the provider directly with `setTokensProvider`. `create()` never throws. Each provider binds the grammar object current when it is made, because loading an embed
  rebuilds every grammar that lists it, and Monaco's saved line states only fit the old one. Embeds load
  per model: a regex scan of fence info strings (including fences inside blockquotes and list items) and
  `lang=` attributes (spaces around `=` allowed) picks the in-catalog `embeddedLangsLazy` the text names
  (markdown 26, vue 8, svelte 2 otherwise) and follows an embed's own lazy embeds transitively
  (vue -> markdown -> shellscript); they load after the first colour, then the provider is re-registered
  so Monaco re-tokenizes. Each scan reports the embeds it loaded that the installed provider lacks, so two
  models scanning at once each re-register for what they finished, not only the first.
  A leading `---` adds `yaml`. A tag at a line start, a closing tag, a comment, or a common inline element
  such as `<img …>`, `<br>` or `<kbd>` adds `html` (front matter and inline HTML embed them with no fence).
  A generic such as `Array<T>` or `Map<K, V>` inside a fence does not count. Fence names the markdown grammar embeds under another language (`jsx` and `es6` as
  `javascript`, `golang` as `go`, `h` as `c`) map through `FENCE_EMBEDS` before the host's `languageId`.
  The `html` catalog entry loads `html-derivative`, the grammar markdown includes for inline HTML.
  The scan reruns on content and language changes. Nothing suspends on the engine or a grammar: a Suspense
  fallback is held for at least 300 ms. The JS regex engine runs only where `WebAssembly` does not exist
  (WebKit Lockdown Mode). A failed `.wasm` fetch or compile fails that highlighter start instead: files stay
  plain and the next file retries, so one transient failure (a dev-server restart, an SPA fallback serving
  HTML) neither pins the 4.5x slower engine for the page nor hides a broken asset behind it. The asset is
  fetched and compiled here and Shiki only instantiates the compiled module, because Shiki's `loadWasm`
  keeps a rejected start for the whole page. A theme that fails to load costs only the colours: the
  highlighter is kept and the next theme swap retries. Shiki's `setTheme` is a no-op for the name it last
  selected, so each swap loads the theme under the other of two names to get the new colour map. The raw
  `shiki/onig.wasm` asset is used because `shiki/wasm` inlines it as base64 and decodes it byte by byte on
  the main thread (about 22 ms at 1x CPU) before the first coloured line. Every shipped host serves `.wasm` as
  `application/wasm`: Vite in dev, `Bun.file` in `serveStatic` for the desktop app and the staged CLI binary.
  Cost: the first open of a new language waits for its grammar chunk (about one frame at 1x CPU), and the
  engine fetches a 466 kB `.wasm` asset; Pierre's newer Shiki ships its own copy.
- **The code view preloads before the first open.** Loading the Monaco chunk, initializing Monaco and
  building the engine only after the tab mounted, behind a fallback held for at least 300 ms, made the
  first open about 420 ms at 1x CPU (840 ms at 4x) against 65 ms for a warm one. With the app's idle
  preload and row-hover warm (`usePreloadResourceView`), the first open is about 120 ms at 1x (430 ms at
  4x, where the rest is Oniguruma compiling the grammar's scanners on the first tokenize). The package
  only offers the mechanism; the host decides when to call it. Cost: every desktop session loads the
  Monaco chunk and the engine (about 3.9 MB decoded, about 7 MB more heap) and a 70 ms evaluation task at
  4x CPU after boot. A click while the preload is still loading suspends as before. A preload that fails
  while the network is down costs the rest of the session: Chromium caches the failed module fetch, so
  every later import of that chunk rejects without a request, and a statically split chunk has no URL to
  cache-bust. The first open then shows the error boundary's **Reload page**, which recovers; on main the
  same outage fails only if it lasts until the first open. The host therefore holds the preload until the
  page is online. `e2e/error-boundary.spec.ts` pins the Chromium behaviour: if a browser update re-fetches a
  failed module, that test turns red and this cost is gone.
- **Monaco mounts without `@monaco-editor/react`.** The wrapper awaited `loader.init()` (a promise even
  with a bundled Monaco) and took two more React commits before `editor.create`. The owned mount creates
  the editor in the view's own commit. Click to visible text, median of 5 interleaved rounds (Chromium,
  Mac Studio): a file open 65 to 34 ms and a tab switch 49 to 30 ms at 1x CPU, 145 to 77 ms and 88 to
  70 ms at 4x. Click to highlighted is no later. Cost: create and first render now run in one task, so the
  longest task after the click grows at 4x CPU (cold open 120 to 145 ms, warm large open 0 to 55 ms). The
  `MonacoEditor` chunk shrinks by 12.1 kB (3.10 MB to 3.09 MB; 3.5 kB gzip).
