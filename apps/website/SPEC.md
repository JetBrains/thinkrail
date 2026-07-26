---
id: module-website
type: module-design
status: active
title: Project website (thinkrail.ai landing)
parent: architecture
tags: [website, marketing]
---

## Responsibility

The project's public website — a single landing page whose creative conceit is that **the site IS the
IDE**: a faithful HTML/CSS recreation of the ThinkRail shell (title bar, project rail, tab strip,
files rail, terminal, status bar) whose center "editor" is the normally-scrolling page content. Each
section poses as a file of a `website` workspace (`README.md`, `features/*.md`, `install.sh`,
`CONTRIBUTING.md`) — except `#why`, which poses as a **chat tab** ("Why ThinkRail?") that replays a
stylized session: the question is typed into the composer, the tab titles itself from it, and the
answer is an animated metro map that builds itself outward from a YOU hub (six token-colored lines +
a Comfort Circle). The chrome reacts to scroll (active tab, tree selection, status-bar line counter)
like the editor is switching files.

**The files rail is the site's table of contents: every tab has a row, including the why chat.** The
rail lists it with a chat icon (and a `title` owning up to it) rather than as a `.md`, and the row
self-titles with the tab. This is a deliberate divergence from the app — where chats live only in the
tab strip and never in the All-files tree — because on the site the rail *is* the nav (on mobile the
hamburger opens it), so a tab missing from it is a section a reader can't find.

Not part of the product: nothing in the app depends on it, and it ships to GitHub Pages, not in the
binary.

## Boundary

- **Standalone leaf.** No workspace deps — it must never import `@thinkrail/contracts`, `server`,
  `shared`, or `web`. It is not on the wire and has no protocol knowledge.
- Vite + vanilla TypeScript + hand-written CSS. No React, no Tailwind, no runtime deps at all —
  `devDependencies` only (`vite` pinned exact, `typescript` via `catalog:`).
- **Brand values are copied, not imported.** Theme palettes are lifted at authoring time from
  `apps/web/src/themes/bundled/*.theme.json` — the app's full bundled set: dark, darcula, light,
  gruvbox, and both `contrast: high` palettes (high-contrast, high-contrast-light) — into the
  site's own CSS custom properties under `[data-theme]`; the site never reaches into `apps/web` at
  build time (the app's tokens assume the theme engine's runtime swap). **The site opens on `light`**
  (`<html data-theme>`, the `theme-color` meta, and the `apply()` fallback all agree) even though the
  app's own default is dark and dark is the CSS base palette that the other blocks layer onto. The
  mapping is
  `colors.sidebar/content/elevated/hover/input/border/borderStrong/text/muted/hint/accent/onAccent/`
  `bubbleAccent/success/warning/danger/info` → `--chrome/--editor-bg/…/--blue`, and `syntax.*` →
  `--sx-*`; a block overrides only what differs from the dark `:root`.
- All marketing copy is static DOM text; JS only *enhances* (scroll-spy, ↑/↓ tile navigation, terminal
  typing, chat streaming replay, theme switcher, copy buttons, star count). The page must read complete
  with JS disabled, and animations are skipped under `prefers-reduced-motion`.
- **The shell resizes to the window, both axes.** *Tabs*: `flex: 0 1 auto` with a
  `min-width: clamp(84px, 9vw, 104px)` floor, so the strip holds natural widths while it has room and
  then shrinks every tab together — all eight stay reachable down to ~670px, below which it scrolls as
  before. Names ellipsize via a `.tab-name` span; the hover-only close glyph is `position: absolute`
  so it costs no width. *Tiles*: `min-height: 100%` + `align-content: center` makes every section at
  least one pane tall with its content centred in the leftover space. `align-content` (not flex/grid)
  is deliberate — it keeps the section a block box, so margins still collapse and the gaps between
  paragraphs, lists and code blocks don't double. **A tile's copy is budgeted against the peek floor**
  (`pane − peek`, 720px at 1440×900) — that is the height five of the eight tiles already sit at, and a
  tile that outgrows it eats the sliver that advertises the scroll. `features/agent-chat.md` was the
  one that had: its transcript is the section's whole proof, so the trim came out of everything around
  it — a one-line question (the visitor asks for brief, so the question is), one line per ring, and no
  composer, since a transcript closed by a Done row does not imply a place to type and the why chat
  still shows a live one. Below 1440 several tiles do still exceed the pane, the transcript most of
  all; ↑/↓ covers them with a second stop.
- **Three affordances say "this scrolls", because one wasn't saying it.** The pane's scrollbar is an
  OS *overlay* (`offsetWidth - clientHeight` gutter measures 0), so it only appears once you are
  already scrolling — and a tile that filled the pane exactly left the fold on a clean edge with
  nothing past it. So: tiles stop a sliver short (`min-height: calc(100% - clamp(44px, 7vh, 72px))`)
  and the fold cuts into the next tab; an **overview ruler** (`.ruler`, one tick per tab beside the
  editor in a shared `.pane` row, lit by the same scroll-spy that drives the tab strip) shows the
  document's depth at rest and doubles as click-to-jump; and a **hero scroll cue** points into the
  cut. The ruler is `aria-hidden` with `tabindex="-1"` ticks — it is a position indicator whose
  destinations the tab strip and files rail already offer to assistive tech, and a third copy is
  noise. The cue is **chrome, not content**: it lives in the `.pane`, not in a section, so it holds
  its place while the tabs scroll under it — it has to sit outside `.editor`, since an absolute child
  of a scroll container scrolls with the content. Being pinned over the page, it is a *chip* (border +
  blurred backdrop): as bare text it gets read as part of whatever it lands on, most often the chat
  composer. It retires (`html.at-end`) at the bottom of the document, where its chevron would
  otherwise promise more below; that toggle rides the status bar's existing scroll listener rather
  than adding a second one.
- **↑/↓ step the editor pane through the sections like tiles.** Stops are each section's top, plus an
  end-aligned stop for any section the pane can't show at once (skipped when the hidden strip is
  smaller than the section's own bottom padding — a stop worth a few dead pixels reads as a broken
  key). The keys stay native when a modifier is held, when the target owns them (`[role="menu"]` — the
  theme menu), and at either end of the pane. Unlike the replays this is *navigation*, so it is not
  gated on `prefers-reduced-motion`; only the easing is (CSS `scroll-behavior`). It takes nothing
  away — the pane is a non-focusable `<main>`, so no key scrolled the page before this.
- **Section replays are owned by the scroll-spy.** A demo (the `agent-chat.md` transcript, the why
  chat) registers a one-shot replay keyed by its section id; the spy fires it when that section
  *becomes the section in view*, so a replay never runs on load — at any window height — and never
  restarts when you scroll back. The spy is the single owner of "what's on screen": demos must not run
  their own `IntersectionObserver` (an element-ratio trigger arms while the demo is still below the
  fold, so on a tall window it plays out unwatched). The always-visible right-rail terminal is not a
  section replay and still types on load.

## Decoy controls

Most of the shell is a *drawing* of the app: the projects rail, the Specs/Changes tabs, the collapsible
folders, the terminal chrome, the why chat's composer, the status-bar widgets, the tab close glyphs. A
visitor will click them. Every one is marked **`data-demo`** in the markup and handled by a single
delegated listener that turns the dead end into the pitch: return to `README.md`, ring + shimmer the
install command, and raise a callout above it — for ~8s, with the rest of the shell dimmed behind a
scrim. A second click replays it rather than doing nothing.

- **The callout is a two-message exchange**, in the site's own chat vocabulary: the visitor's implied
  question right-aligned in a small bubble, the agent's answer left-aligned in a large round one, both
  inside a chat panel. A dead click then reads as *the agent replying to you*, not as a tooltip firing
  — which is the product's pitch, delivered by the shell pretending to be the product.
- **It plays rather than appears**: question → a typing bubble → the answer → a row of arrows, on the
  same `[data-step]`/`.on` idiom as the section replays. The staging is gated on `html.anim`, so a
  reduced-motion visitor gets the finished conversation (and never the typing bubble) instead of an
  empty panel; the timers are cleared and re-armed on every click, so a second click restarts the
  exchange instead of stacking a second one on top.
- **Any click or keypress ends it early** — an 8-second overlay you cannot dismiss is worse than one
  you miss. The teardown *is* the dismiss handler, and it detaches its own listeners; the decoy
  handler calls it before replaying, so the click that opens the callout can't also close it (a
  listener removed mid-dispatch is skipped for the event already in flight). Clicking another decoy
  therefore replays rather than merely closing.
- **A row of thick double chevrons, not one thin arrow** — at display size a single hairline reads as
  a stray mark. They shimmer on the same 1.6s period as the text and the command, staggered left to
  right. The pulse animates the *stroke colour*, not opacity: the arrows lie over page text, and
  anything translucent lets that text bleed through and read as if it were in front of them.
- **Gold (`--gold`), not the accent.** The page is already accent-coloured throughout, so the one
  element asking to be noticed borrows the theme's warning hue; the command's ring and sweep turn gold
  with it, so callout and target read as one thing. Every bundled palette defines `--gold`, so it
  lands in all six.
- The panel is **opaque** by construction (`color-mix(--gold, --editor-bg)`), which is also what
  clears the lede: display type printed straight over running copy leaves both unreadable.
- **The spotlight is a scrim, not opacity on the shell.** `html.hint-on` fades in `.dim-scrim` (an
  absolute child of the fixed `.window`), and `.install-line.nudge` takes `z-index: 100` to sit above
  it. That works because nothing between them — `.pane` is `position: relative` with `z-index: auto` —
  opens a stacking context that would trap the command underneath.
- The message shimmers with the same sweep as the command, painted through the glyphs via
  `background-clip: text` on an inner span — the box needs its own background, and `background-clip:
  text` would clip that too. The gradient spans the whole run, so the text stays legible wherever the
  animation happens to stop.

- **The marker is opt-in, in the markup** — a new fake control is wired by adding the attribute, not by
  editing a selector list in JS. The inverse is the invariant worth testing: **no real control may sit
  inside a `[data-demo]`**, or the delegated `preventDefault()` would eat it. Real controls (file/tab
  links, copy buttons, theme menu, GitHub, hero CTAs, nav toggle) are deliberately left unmarked, and
  the marked elements are chosen tightly for that reason — `.terminal-label` and `.terminal-tab`
  individually, never their parent `.terminal-head`, which holds a working copy button.
- `preventDefault()` is unconditional because some decoys live *inside* a real link (the `.tab-x`
  close glyphs): clicking the × should pitch the install, not navigate the tab.
- On mobile the handler closes the right-rail drawer first — otherwise the drawer covers the very
  thing it just pointed at. That is why the drawer's three state writes are behind one `closeRail()`.
- The shimmer is gated on `html.anim`; the ring and the hint are not — they are the message, not the
  decoration.

## Deploy

`.github/workflows/site.yml` builds (`bun run --filter @thinkrail/website build`) and publishes
`apps/website/dist` to GitHub Pages on pushes to `main` that touch this module (plus manual dispatch).
Vite `base: "./"` keeps the build servable at `/thinkrail/` and on any custom domain. One-time repo
settings: Pages → Source: GitHub Actions, and Pages → Custom domain: `thinkrail.ai` — the public
identity. Canonical/OG URLs in `index.html` (and the README website link) point at
`https://thinkrail.ai/`, never the `jetbrains.github.io/thinkrail` address (which redirects there).

## Assets

`public/og.png` is a capture of the site's own hero, which means **it goes stale whenever the shell
or the default theme does** — it is a screenshot, not a rendering the build regenerates. Re-capture
it by loading the dev server at **1520×798** (the 1200:630 ratio exactly, so the downscale crops
nothing) with `deviceScaleFactor: 2` and `reducedMotion: "reduce"`, then resizing to 1200×630.
Reduced motion is what makes the capture reproducible: it is the finished static state, so the tab
reads "Why ThinkRail?" instead of the mid-replay "chat", and no step is caught half-animated. 1520
rather than the target width is a two-way fit — narrower and the pinned scroll cue lands on the CTA
row, wider and the hero type is too small to read at feed size.

The transcript in the `features/agent-chat.md` section is from a real `pi` session captured in the
app while it worked on this repo.

The `#why` chat is, by contrast, a hand-authored *simulation* (no captured session): its metro-map
SVG is hand-drawn, colored entirely by theme tokens, and its replay/build animation is fully gated
on `html.anim` (JS present + motion allowed) — the finished map is the static state, so the section
reads complete with JS disabled and under `prefers-reduced-motion`.

**The map's six spokes are the six compass points around the hub**, so a new line means claiming an
empty quadrant, not squeezing one in: Spec/Worktree/IDE fan out to the right, Engine/Rails/Open
Source to the left, each an exact mirror of its opposite (path, station spacing, label offsets). The
Open Source Line took the last free one, bottom-left, which is why the Comfort Circle's caption moved
out from under it to the centre bottom, hanging off the ring's own six-o'clock dot. Its color is
**`--text`**, the ink: the palette's five accents were already spent one per line, `--bubble`
collapses onto `--accent` in three of the six themes, and a black (or, on dark, silver) line is real
metro vocabulary. It is also the one token guaranteed maximum contrast in every theme, which suits
the line whose claim is that nothing is hidden. The hub's caption plate crosses both bottom diagonals
symmetrically — that is the label sitting over the junction, as on a real map, not a broken rail.

The Comfort Circle is drawn in **`--comfort`**, the one *derived* token on the page: a sea-green
`color-mix` of `--blue` and `--green` rather than a per-theme literal, so it follows a theme swap for
free and never becomes a seventh palette entry to keep in sync. It is deliberately not grey — the
ring is the map's only promise rather than a feature, and `--hint` made it read as a dropped rail
next to six live ones. The ring, its two dots and its label take the color; the cargo captions below
stay grey, which is the badge/cargo pairing every spoke already uses.
