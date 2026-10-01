---
id: task-review-surface
type: task-spec
status: draft
title: Review surface platform — ReviewAnchor generalization + Resource Renderer Registry
parent: module-web
depends-on: [module-contracts]
references: [submodule-server-reviews, submodule-web-panels, submodule-web-chat-tools, task-change-mutations]
tags: [review, ui]
---

# Review surface platform — ReviewAnchor generalization + Resource Renderer Registry

## Summary

The review surface is rebuilt on two engine-neutral seams and one engine decision:

1. **`ReviewAnchor` generalization** — a comment anchors to any position a renderer can name (a line
   range, a notebook cell, a JSON node, a table cell, an image region) while the host keeps re-anchoring
   text-bearing resources exactly as today. Additive wire change in `contracts`, one rule change in
   `server/reviews`.
2. **`ResourceRendererRegistry`** — a web sub-module that decides *how a resource is shown* (view and
   diff) by match, rank and capabilities. `FilePane`/`DiffPane` become dispatchers; the `isMarkdownPath`
   branches, the `view`/`rendered` tab fields and their toggles are deleted.
3. **Engines.** `@pierre/diffs` renders **every diff on every viewport** and **every file on phone-class
   viewports**; Monaco renders **files on desktop** only. `MonacoDiff.tsx`, `@monaco-editor/react`'s
   `DiffEditor` usage and the Monaco diff theme are deleted. Monaco never loads on a phone.

Decided with the user (2026-10-01): no pilot, no feature flags, no compatibility layers; third-party VS
Code extensions are not a goal; the first write-path is revert hunk/file + ask-the-agent
([[task-change-mutations]]); mobile scope is review + comments + approvals. This document is removed once
the work lands in the owning specs (`submodule-web-panels`, `submodule-server-reviews`,
`module-contracts`, `architecture`, and the new `submodule-web-resources`).

## The contract

### A. `ReviewSelector` (contracts, additive — pinned by `REVIEW_RICH_ANCHORS_PROTOCOL_VERSION`)

```ts
export type ReviewSelector =
  | { kind: "lineRange"; startLine: number; endLine: number }
  | { kind: "textQuote"; exact: string; prefix: string; suffix: string }
  | { kind: "diffHunk"; hunkHeader: string }                                  // populated by ask-the-agent, see task-change-mutations
  | { kind: "structural"; scheme: string; ref: string }
  | { kind: "region"; x: number; y: number; width: number; height: number; page?: number };
```

- **`structural` is the typed-by-scheme selector for document models with stable identities.** Schemes:
  `json-pointer` (RFC 6901 pointer; JSON, YAML and TOML through their JSON model), `ipynb-cell` (the cell
  `id`, or `index:<n>` when the notebook predates ids), `table-cell` (`<row>:<column>` in data
  coordinates, header row 0; CSV/TSV), `md-heading` (heading slug). Unknown schemes are preserved
  verbatim by the host and never rejected: a renderer registered by a pi package defines its own.
- **`region` is normalized geometry** (`0..1` of the rendered intrinsic size; `page` for paged media) for
  raster and vector images, PDF pages and SVG.
- **Text selectors are mandatory wherever the resource has source text.** A renderer that anchors to a
  cell, node or table cell also emits `lineRange` in RAW-file coordinates (the host adds `textQuote`).
  Only byte-only resources carry `region`/`structural` without text selectors. This keeps the host's
  re-anchoring, the send package's fragments and the Review sidebar's refs working for every renderer —
  the rule rendered markdown already lives by (`sourceLines.ts` stamps).
- `ReviewAnchor` is unchanged (`path`, `side`, `baseRef`, `scope`, `contentHash`, `selectors`).
  `contentHash` is sha-256 over bytes (identical to today's text hash for valid UTF-8).

### B. Server rules (`submodule-server-reviews`)

- `reanchor`: a hash mismatch on a **positioned** anchor (any `lineRange`/`structural`/`region`
  selector) with **no `textQuote`** is `outdated`, never `moved` — a re-pin needs evidence and a
  byte-only resource has none. (Today's code returns `moved` with a refreshed hash.) A whole-file anchor
  (no selectors — the `file` comment kind) keeps today's behaviour: hash mismatch → `moved`, hash
  refreshed, because the remark is about the file, not a position in it.
- `review.commentAdd` accepts any selector set. Text-bearing resources get `textQuote` derived from
  `lineRange` as today; byte-only resources store the hash and the renderer's selectors verbatim.
  Validation: `region` components in `[0, 1]`, `structural.ref` non-empty, `scheme` matching
  `/^[a-z][a-z0-9-]*$/`.
- **Send package**: a non-text anchor renders as a locator line instead of a fragment —
  `image region x=0.12 y=0.40 w=0.30 h=0.10 of docs/arch.png (sha256 …)`, `cell 7 (id a1b2) of
  analysis.ipynb` followed by the cell source when the resource has text. The agent reads the resource
  with its own tools, as it does for code.
- `anchorState` semantics are unchanged. A `structural`/`region` anchor on a text-bearing resource
  re-anchors through its text selectors; the renderer re-validates the structural part when placing it
  and shows `outdated` when the node/cell no longer exists.

### C. Web sub-module `apps/web/src/resources/` (barrel; `submodule-web-resources`)

```ts
export interface ResourceDescriptor {
  workspaceId: string;
  path: string;
  mime?: string;            // host-sniffed; extension-derived fallback on the client
  language?: string;        // Shiki language id when text
  text: boolean;            // valid UTF-8 (host-reported)
  byteLength?: number;
  scope?: GitDiffScope;     // present for diffs
}

export type ResourceContent =
  | { kind: "text"; text: string; hash: string }
  | { kind: "bytes"; url: string; hash: string; byteLength: number }   // /files or /blob URL (task-change-mutations §D)
  | { kind: "absent" };                                               // an absent diff side has no fetchable URL

export interface AnchorDraft { selectors: ReviewSelector[]; label: string }  // label = sidebar ref: "L3", "cell 7", "region"

export interface SurfaceReview {                 // replaces SideReview; renderer-agnostic
  threads: ReviewThread[];                       // anchor-keyed (ReviewComment.anchor + status + body)
  commenting: {
    onSave(draft: AnchorDraft, text: string): Promise<void>;
    onSend(draft: AnchorDraft, text: string): Promise<void>;
  };
  actions: ReviewThreadActions;                  // send / delete / update
  focus: { id: string; anchor: ReviewAnchor } | null;
  onFocusHandled(): void;
}

export interface ResourceViewProps {
  resource: ResourceDescriptor; content: ResourceContent;
  review?: SurfaceReview;                        // absent → read-only, no authoring
  viewState?: unknown; onViewState?(state: unknown): void;   // scroll / fold / zoom, persisted per tab
}
export interface ResourceDiffProps {
  resource: ResourceDescriptor; original: ResourceContent; modified: ResourceContent;
  layout: "split" | "unified"; ignoreWhitespace: boolean;
  review?: { worktree: SurfaceReview; base: SurfaceReview };   // the two anchor spaces stay separate
  hunkActions?: HunkActions;                     // task-change-mutations; absent for commit scopes
  viewState?: unknown; onViewState?(state: unknown): void;
}

export type ResourceAnchorCapability = "line" | `structural:${string}` | "region";

export interface ResourceRenderer {
  id: string;                                    // "thinkrail/code", "thinkrail/markdown", …
  label: string;                                 // view-toggle caption
  match: { glob?: string[]; mime?: string[]; language?: string[]; text?: boolean };
  rank: number;                                  // highest wins; bundled 100, project-trusted 200, user 300
  capabilities: {
    view: boolean; diff: boolean;
    anchors: {
      view: ReadonlyArray<ResourceAnchorCapability>;
      diff: ReadonlyArray<ResourceAnchorCapability>;
    };
    mobile: boolean;                             // false → never resolved on a phone-class viewport
    active: boolean;                             // renders active content → sandboxed iframe
  };
  trust: "bundled" | "project" | "user";
  loadView?(): Promise<{ default: ComponentType<ResourceViewProps> }>;   // lazy — heavy libs stay split
  loadDiff?(): Promise<{ default: ComponentType<ResourceDiffProps> }>;
}

export function registerResourceRenderer(r: ResourceRenderer): () => void;
export function resolveRenderers(d: ResourceDescriptor, intent: "view" | "diff", env: { mobile: boolean }): ResourceRenderer[]; // ordered, never empty
```

- **Resolution** filters by `match`, the requested capability and `env.mobile`, orders by `rank`, and ends
  with the fallbacks: `thinkrail/code` for text, `thinkrail/binary` for bytes. The ordered candidates are
  the pane's **view toggle** (one `ToggleSegment` over renderer ids — the single toggle grammar for
  Preview/Source, Rendered/Source and every richer format); the chosen `rendererId` is persisted on the
  tab. A tab with no `rendererId` opens the first candidate.
- **Registration is a side effect** mirroring `chat/tools/register.ts`: bundled renderers register from
  `panels/resources/register.ts` when the workbench mounts. The registry holds metadata and loaders only.
- **Review integration is the pane's job.** `useFileReview` returns `SurfaceReview`; `LineSelection` and
  the line-keyed `ReviewThreadData` are deleted. A renderer owns the mapping anchor ↔ geometry: Monaco
  maps `lineRange` to view zones; Pierre maps `lineRange` to annotations and line selection; the markdown
  preview maps source stamps to blocks; the image renderer maps `region` to an overlay; the notebook
  renderer maps `structural:ipynb-cell` to a cell card. Anchor capabilities are declared separately for
  view and diff intent. A thread the current renderer cannot place in that intent renders in the pane's
  **unplaced strip** above the content with a "show in <renderer>" action — never
  dropped, never guessed.
- **Active content is a security boundary.** `capabilities.active` renderers mount in a sandboxed iframe
  (`sandbox="allow-scripts"` at most, no `allow-same-origin`, a CSP without network), receive the design
  tokens as CSS variables and content by `postMessage`. Non-active bundled renderers render in-process.
- **Trust tiers** order rank and gate registration: `bundled` ships with the app; `project` renderers come
  from a trusted project's pi packages (project trust, as with skills); `user` renderers from personal pi
  packages. A renderer shipped by a pi package is an ESM module importing only `@thinkrail/contracts` and
  React as externals, listed in the package manifest and served by the host — the same shape as a bundled
  renderer, loaded with a dynamic `import()`.

### D. Renderers

| id | match | view | diff | anchors (view / diff) | mobile |
| --- | --- | --- | --- | --- | --- |
| `thinkrail/code` | `text: true` | **Monaco** (desktop) · **Pierre `File`** (mobile), read-only | **Pierre `FileDiff`** — split/unified, word-level, collapsed unchanged, hunk toolbar | `line` / `line` | Monaco no · Pierre yes |
| `thinkrail/markdown` | `*.md`, `*.mdx`, `text: true` | `MarkdownPreview` | `RenderedDiff` (htmldiff) | `line` / — | yes |
| `thinkrail/image` | `image/*` | fit / zoom / 1:1 | 2-up · swipe · onion skin · difference | `region` / `region` | yes |
| `thinkrail/svg` | `image/svg+xml` | sandboxed render | render both + source diff via `code` | `region` / `line` | yes |
| `thinkrail/csv` | `*.csv`, `*.tsv` | table | row/cell diff (daff-style alignment) | `line`, `structural:table-cell` / same | yes |
| `thinkrail/json` | `*.json`, `*.yaml`, `*.yml`, `*.toml` | collapsible tree | structural diff (`jsondiffpatch`, move detection) | `line`, `structural:json-pointer` / same | yes |
| `thinkrail/notebook` | `*.ipynb` | cells: markdown + Shiki code + outputs (outputs sandboxed) | cell-aligned diff (ids, then source similarity); per-cell `code` diff; image-output diff | `line`, `structural:ipynb-cell` / same | yes |
| `thinkrail/pdf` | `application/pdf` | pdf.js pages | side-by-side pages | `region` (+ `page`) / same | yes |
| `thinkrail/html` | `*.html` | sandboxed preview | sandboxed both sides | `line` / `line` (via `code`) | yes |
| `thinkrail/binary` | fallback | size, hash, open externally | "binary files differ" + sizes | — / — | yes |

`thinkrail/code` is one registration with a viewport-dependent `loadView` (Monaco or Pierre `File`);
`capabilities.mobile` is evaluated per implementation. `svg`, `html` and notebook outputs are `active`.

## Architecture

- **New sub-module `apps/web/src/resources/`** (barrel): registry, types, resolution, `anchorLabel`,
  `isPlaceable`. Deps: `contracts` (types), `lib`. No `store`, no `transport` — a leaf the panes
  integrate, like `chat/toolRegistry`.
- **`panels` → `resources`.** `FilePane`/`DiffPane` resolve → `Suspense` → render the chosen renderer with
  content, `SurfaceReview`, `hunkActions` and the tab's view state. Bundled renderers live under
  `panels/resources/<renderer>/` and register from `panels/resources/register.ts`. `MonacoDiff.tsx`,
  `editorWrapping.ts`'s diff use, the `THEME` (content-bg) Monaco theme, `reviewGutter.ts` and the
  line-keyed widget API are deleted; `reviewWidgets.ts` becomes the Monaco implementation of
  `SurfaceReview` placement. `reviewModel.ts` gains `anchorLabel` and keeps `ReviewSurface` routing.
- **Pierre integration** (`panels/resources/code/PierreDiff.tsx`, `PierreFile.tsx`): `FileDiff`/`File`
  from `@pierre/diffs/react` with the worker pool (`@pierre/diffs/worker`), ThinkRail's Shiki theme (the
  CSS-variable theme the chat already uses), `enableLineSelection` feeding `AnchorDraft`s, annotations
  rendering `ReviewThreadCard`, `onLineClick`-free hunk toolbar supplying `HunkActions`, unified layout
  forced on phone-class viewports. Theme tokens reach Pierre's Shadow DOM through CSS custom properties;
  no `@pierre/theme` preset is applied.
- **`store`:** `FileTab`/`DiffTab` carry `rendererId?: string` and `viewState?: unknown`; `view`,
  `rendered` and `setFileTabView`/`setDiffTabRendered` are deleted; `DiffTab.view` (`split`/`inline`) and
  `ignoreWhitespace` stay as diff layout state. Persisted layout documents that still carry the deleted
  fields are read with those fields ignored.
- **Mobile** is the shell's existing phone-class viewport flag passed to `resolveRenderers`; Monaco's
  chunks are never requested on a phone.
- **Host capabilities** this depends on are specified in [[task-change-mutations]] §D: `ResourceMeta` on
  `fs.readFile`/`git.diffFile` and the `/blob` route for byte-only original sides.
- **`architecture.md` Decision #18** lands with this work:

> **The review surface is engine-neutral; renderers are registered, not hard-wired.** Resources are shown
> by renderers chosen by match, rank and capabilities; review comments anchor through `contracts`'
> `ReviewSelector` set, which every renderer maps to its own geometry. `@pierre/diffs` renders every diff
> and every phone-class surface; Monaco renders files on desktop and never loads on a phone. ThinkRail
> hosts no VS Code extensions; language intelligence is imported as libraries. Decision #5's "Monaco
> editor" panel reads as "the code renderer".

## Semantics

- **Anchors are authoritative on the host; renderer geometry is a projection.** Monaco view zones, Pierre
  annotations and image overlays derive from `ReviewComment.anchor`; none rewrites it except through
  `review.commentAdd` and the host's re-anchoring.
- **Two anchor spaces stay two.** A diff renderer receives `review.worktree` and `review.base`; a base
  selection is never translated into worktree coordinates.
- **A renderer may refuse a selection.** `onSave` is reachable only with an `AnchorDraft` the renderer can
  place later; a selection it cannot express degrades to the nearest expressible anchor and says so in
  the composer, or to a whole-file comment — never to a wrong position.
- **Unplaced ≠ outdated.** A comment the current renderer cannot place shows in the unplaced strip;
  `anchorState` is untouched.
- **Mobile resolution is a hard filter**, not a preference, and unified is the diff layout there.
- **View state belongs to the tab**: `viewState`/`onViewState` round-trip opaque renderer state (Monaco
  `saveViewState()`, Pierre scroll offset, image zoom) through the store, so a tab switch restores
  position.

## Build order and acceptance

1. `contracts` + `server/reviews`: selector union, validation, byte-only `reanchor` rule, locator lines.
   Unit tests: byte-only mismatch → `outdated`; structural + text selectors on a moved cell → `moved`
   with updated `lineRange`; invalid `region` rejected.
2. `resources` sub-module; `FilePane`/`DiffPane` dispatch; `SurfaceReview` in `useFileReview`; Monaco
   file renderer hardened (one theme + container backgrounds, diagnostics off, `unicodeHighlight`
   ambiguous off, `@shikijs/monaco` tokens, full theme keys, view state); `thinkrail/markdown` and
   `thinkrail/binary` registered.
3. **Pierre diff renderer replaces `MonacoDiff`** with annotations, line selection, hunk toolbar wired
   to [[task-change-mutations]], split/unified, ignore-whitespace; `MonacoDiff.tsx` and its theme are
   deleted; Pierre `File` for mobile code. `e2e/changes.spec.ts` and `e2e/review.spec.ts` are rewritten
   against the new testids.
4. `image`, `svg`, `csv`, `json` renderers with anchor round-trip tests (create → edit → re-anchor →
   place).
5. `notebook`, `pdf`, `html` renderers (sandboxed active content).
6. Full `bun run e2e` once after step 3 and once after step 5.

Acceptance: a comment on an image region, a table cell, a JSON node and a notebook cell can be created,
re-anchored after an edit, placed by its renderer and rendered in the send package; no Monaco chunk is
requested in the phone-class e2e viewport; the `rendererId` toggle shows exactly the candidate list.

## Decision log

- **Reuse the reserved `structural` slot instead of one union member per renderer** — closed wire over
  renderer-defined schemes; `region` is the only new member because geometry has no sensible string form.
- **Text selectors stay mandatory where text exists** — anchoring by id alone would drop re-anchoring,
  fragments and sidebar refs for every new format.
- **Registry in a new `resources` sub-module** — panels are per-file imports (lazy heavy libs); the
  registry must be importable without pulling a renderer, and it owns the extension manifest handling.
- **`rendererId` replaces `view`/`rendered`** — one field and one toggle grammar.
- **Pierre for all diffs, Monaco for desktop files** (user decision) — Monaco's reading tools (find,
  folding, sticky scroll, go-to-line) are the "more functionality" answer for files; Pierre's unified
  review grammar and mobile support are the answer for diffs. No flag, no fallback renderer.
- **No VS Code Comments API** — text-document-centric; cannot carry `region`/`structural`; ThinkRail
  anchors are the only authority.
- **Byte-only resources re-anchor to `outdated` on change** — "moved" needs evidence.
