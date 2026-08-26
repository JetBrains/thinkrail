---
id: module-website
type: module-design
status: active
title: Project website (thinkrail.ai landing)
parent: architecture
tags: [website, marketing]
depends-on: [module-website-analytics]
---

## Responsibility

The project's public website — a landing page and blog whose creative conceit is that **the site IS
the IDE**: a faithful HTML/CSS recreation of the ThinkRail shell (title bar, project rail, tab strip,
files rail, terminal, status bar) whose center "editor" is the normally-scrolling page content — the
blog included (see Blog below). Each
section poses as a file of a `website` workspace (`README.md`, `why.md`, `features/*.md`,
`install.sh`, `CONTRIBUTING.md`). The **file tree is the source of truth for the page's navigation
structure**, and its selection reacts to scroll (scroll-spy) like the editor is switching files. The
top editor **tab strip is derived from that file-tree navigation** — not a hand-maintained list — and
is interactive: the active tab **follows the currently visible section via the same scroll-spy**, and
**clicking a tab scrolls to its section**. The strip holds **exactly one navigational tab per unique
section target**: the tree may stay hierarchical and repeat a target across rows, but duplicate
targets collapse to a single tab, so scroll-spy always activates exactly one tab per section. The
strip **scrolls** (`overflow-x: auto`, scrollbar hidden) — the tabs overflow below ~1500px and every one
must stay reachable. Its bottom divider is drawn **per tab**, not on the strip: a strip border sits
outside the scrollport, where the active tab cannot paint over it to merge into the content. The
status bar is a plain copyright footer, not a live line counter.

Not part of the product: nothing in the app depends on it, and it ships to GitHub Pages, not in the
binary.

## Boundary

- **Independently deployed leaf.** Its only workspace dependency is [[module-website-analytics]]; it
  must never import contracts, server, shared, web, or the vibecoding site. It is not on the wire and
  has no protocol knowledge.
- **Astro (static output) + vanilla TypeScript + hand-written CSS.** No client-side framework
  runtime: Astro ships zero JS by default and every interactive bit stays hand-written TS
  (`src/main.ts`, `src/theme.ts`). There is no Tailwind or external runtime dependency; the one
  browser analytics workspace module is compiled into the static output. The two
  `@fontsource-variable/*` packages are build-time asset sources: the build emits
  their woff2 files into `dist/`. They are shared with `apps/web`, so they come from the root
  `workspaces.catalog` — one pin for both apps, which is what keeps the site's faces identical to the
  app's.
  - *Why Astro (decision, 2026-08):* the blog + planned docs fired the "bespoke SSG" tripwires
    (RSS, OG, typed frontmatter, content DX). Astro is Vite underneath — the landing page ported
    verbatim, `bun test` suites unchanged — and React 19 islands are available the day a page needs
    one (none do today). Rejected: Next.js static export (ships the React runtime to static pages,
    non-Vite culture), VitePress (Vue), Eleventy (docs features assemble-yourself — the bespoke trap
    again), Hugo/Zola (non-TS toolchain, token/tests integration lost). The prior bespoke pipeline
    (`scripts/build-blog.ts` + HTML string templates) is deleted.
  - *Lint caveat:* Biome parses only `.astro` frontmatter, so `noUnusedVariables`/`noUnusedImports`
    are disabled for `*.astro` in `biome.json` (template usage is invisible to it — every flag would
    be a false positive). `astro check` covers the templates instead.
- **Fonts are self-hosted; the site makes no external font request.** Packages and stacks are copied
  from the app's `typography.json`, not imported — and `src/fonts.test.ts` reads that JSON at test time
  and fails on drift, which is what makes copying safe. `--font-display` mirrors the app's `brand`
  family — **Orbitron** (`@fontsource-variable/orbitron`, self-hosted), a distinct display face for the
  brand elements (wordmark + hero heading), falling back to `--font-sans`; section headings and the
  tagline are the interface face (`--font-sans`), matching the app.
- **Brand values are copied, not imported.** Theme palettes are lifted at authoring time from
  `apps/web/src/themes/bundled/*.theme.json` (dark = default, darcula, light, gruvbox) into the site's
  own CSS custom properties under `[data-theme]`; the site never reaches into `apps/web` at build time
  (the app's tokens assume the theme engine's runtime swap).
- **Shared page chrome is single-sourced in components.** `src/components/BaseHead.astro` is the one
  head every page uses: charset/viewport, favicon, global stylesheet (which bundles the fonts), the
  pre-paint theme guard, and the analytics loaders. `src/components/IdeShell.astro` is the one IDE
  shell every page's body renders through — icon sprite, skip link, title bar (workspace name
  parameterized: `website` on the landing, `blog` on blog pages, each with the matching
  `workspace/<name> · from main` branch label), the left project rail, the right files rail +
  terminal, the status bar, and the `main.ts` script import; the center column is its default slot
  and the right rail's Files rows its `filetree` slot. The left rail carries the site's real
  navigation as child rows of the `website` workspace — **Landing** (`/`) and **Blog** (`/blog/`,
  selected on the index and on every article) as links, **Docs** disabled with a `Coming soon` chip
  (no tooltip — the tag carries the state) — while the remaining mock rows keep the
  `data-mock-hint` treatment; the selected row wears the same accent-tinted grammar as the right
  rail's active file row (one grouped CSS rule). `src/components/Copyright.astro` is the one
  copyright line (shell statusbar). The dark/light theme model lives in
  `src/theme.ts` (explicit choice in `localStorage` → `prefers-color-scheme` fallback, live
  system-follow, legacy `darcula`/`gruvbox` values normalize to dark); the inline FOUC guard in
  BaseHead is its declared twin — a behavior change updates both.
- **A colour with a contrast floor gets a `:root` token, never the region-inherited `--accent`.**
  A region may re-point `--accent` (the light theme's kicker pill does; the hero once did), so
  descendants reading it can inherit a value chosen for another surface. `--link` and `--focus-ring`
  are declared once on `:root` as `var(--accent)`, which resolves against the *root* accent —
  per-theme, but out of reach of a region override.
- **The primary button (and the hero's brand accents) are per-theme, not a brand constant** (decision
  reversed 2026-08 on review — the light theme kept the dark theme's bright green): the
  `--control-primary-*` tokens mirror the app's semantic mapping (`bg = accent`, `hovered =
  accentHover`, `text = onAccent`, per `apps/web/src/styles/colors.json`), declared on `:root` via the
  root-token mechanism above, with `--accent-hover` copied per theme from the app's palettes. The hero
  title follows the theme accent like every other accent-coloured element; `palette.test.ts` pins the
  hovered-fill label contrast.
- All marketing copy is static DOM text; JS only *enhances* (scroll-spy, the derived editor-tab strip
  and its scroll-spy/click navigation, terminal typing, chat streaming replay, theme switcher, copy
  buttons, star count, install-platform selection). The page must read complete with JS disabled (the
  editor tabs are a JS-built navigation affordance over content that is already reachable by scrolling
  and via the file tree), and animations are skipped under `prefers-reduced-motion`.
- **Enhancement behaviors owned by `main.ts`** (the code carries no rationale — this is it):
  - *Terminal replay*: the hero install picker is the single source of truth for the visible command;
    the terminal subscribes and types the command for the selected OS/shell, then the short install
    transcript. A generation counter invalidates an in-flight sequence on OS change; clicking the
    *finished* terminal (or its keyboard-reachable `Replay logo` button, revealed only then) replays
    the ASCII logo + a GitHub CTA — never the install. The logo banner's characters are never
    altered; only its font size is fitted to the rail width (re-fitted on resize).
  - *Worktree note* (left rail): starts visible in markup (reads with JS disabled); an inline script
    hides it pre-paint and `main.ts` reveals it after 5s — once per session (`sessionStorage`),
    never again after Understood (`localStorage`), with a 10s inline-script fallback if `main.ts`
    fails to load. Storage access is fully guarded (retrieving the storage object itself can throw).
  - *Mock-callout tooltips*: `data-mock-hint` regions (right-rail tabs, the left rail's remaining
    mock rows) open a click-persistent callout with a GitHub CTA — click-outside/Escape closes,
    Escape restores focus. A11y contract: the trigger becomes `role="button"` with `aria-label`
    (from `data-mock-label`), `aria-expanded` + `aria-describedby` on open — no `aria-haspopup`
    (a `tooltip` is not an allowed popup value). The `.rail-tabs` callout anchors to the panel's
    live edge; others place beside the trigger, clamped to the viewport and repositioned on resize.
- The hero's install command has **macOS / Linux / Windows** tabs. Browser hints choose only the
  initial supported desktop OS; they never hide alternatives or claim to detect an ambiguous mobile
  platform. Windows adds **PowerShell / Command Prompt (cmd) / WSL** tabs with shell-native commands:
  PowerShell runs `irm …/install.ps1 | iex` directly in the current session, Command Prompt launches
  `powershell -c "irm …/install.ps1 | iex"`, and WSL uses `install.sh` to install the Linux build inside
  that distro. ARIA structure: a `tablist` may contain nothing but `tab`s, so the OS tabs form their
  own tablist and the Windows shell switcher is its *sibling* (its own tablist), shown inline only
  while Windows is active so the component height never changes. Every hero panel remains in the
  static DOM; JS turns the complete fallback into the tabbed view. The detailed Install section keeps
  its complete mixed-platform reference and labels the distinct PowerShell and Command Prompt (cmd) lines.

## Analytics

`src/analytics.ts` is the site-local facade over [[module-website-analytics]]. It supplies the exact
production hostname `thinkrail.ai`; the shared module owns the PostHog and GTM identifiers, privacy
configuration, and typed script loaders. Localhost, `astro dev`, previews, the
`jetbrains.github.io` apex, and sibling subdomains send nothing.

Every page initializes the combined analytics facade through `BaseHead.astro`; no page carries vendor
configuration or a second loader. The site test pins its production-host identity and disabled hosts,
while the shared package tests the common PostHog/GTM contract. The shared contract deliberately has
no `posthog-js` dependency, pasted bootstrap, or static GTM `noscript` iframe; its spec owns the
cookieless behavior and consent caveat.

## Deploy

`.github/workflows/site.yml` builds (`bun run --filter @thinkrail/website build`, which runs
`astro check && astro build`) and publishes `apps/website/dist` to GitHub Pages on pushes to `main`
that touch this module, [[module-website-analytics]], the root package manifest, or the lockfile (plus
manual dispatch). The root files are included because catalog and resolved dependency changes alter
the artifact even when this app's manifest is unchanged. Asset URLs are root-absolute against
`site: "https://thinkrail.ai"` (astro.config.ts) — the `jetbrains.github.io/thinkrail` address is
not independently servable, which is fine because it redirects to the custom domain. One-time repo
settings: Pages → Source: GitHub Actions, and Pages → Custom domain: `thinkrail.ai` — the public
identity. Canonical/OG URLs in `index.html` (and the README website link) point at
`https://thinkrail.ai/`, never the `jetbrains.github.io/thinkrail` address (which redirects there).

**The deploy fails fast rather than hanging.** `deploy-pages` only creates the Pages deployment and then
polls it, so a stalled backend hangs the step until timeout — 10min on 2026-08-06 (`31107056870`),
leaving `main` red and the site stale. Hence `timeout: 180000` (a healthy deploy reports `succeed` in
~10s), `retention-days: 7` on the artifact so re-running the `deploy` job stays a valid remedy for a
week, and `cancel-in-progress: false` so an in-flight publish finishes. Don't add an in-job retry: the
deployment is keyed by `GITHUB_SHA` and the timeout cancels it, so a second attempt moments later only
reads back `deployment_cancelled`. Re-deploying that SHA *later* is fine — hence the remedy above.

### PR preview deploys

PRs that touch this module, [[module-website-analytics]], the root package manifest, or the lockfile
get a **preview URL** so design review happens against the rendered site,
not the diff: `.github/workflows/site-preview.yml` runs the *same build command* as `site.yml` (one
build definition — never let the two drift) and uploads `apps/website/dist` to **Cloudflare Pages**
via `bunx wrangler@<pinned> pages deploy --project-name=thinkrail-previews --branch=pr-<num>`. The
per-PR alias URL is deterministic — `https://pr-<num>.thinkrail-previews.pages.dev` — and is surfaced
as a sticky PR comment (marker `<!-- thinkrail-site-preview -->`, edited in place each push, via
`gh api` — no third-party comment action) plus a `Website preview` commit status on the head SHA.
The workflow polls the URL until it serves 200 before posting (a fresh `pr-<num>` subdomain 522s for
its first ~20s — observed at setup, 2026-08-20) so the designer never receives a dead link.

Boundaries of the preview path (decisions, 2026-08):
- **Production is untouched**: GitHub Pages + `thinkrail.ai` remain the only production host;
  Cloudflare Pages hosts previews *only* (the project's production branch is `main`, which we never
  deploy there, so every upload is a preview deployment).
- **Same-repo PRs only**: the job is guarded by `head.repo.full_name == github.repository`. Fork PRs
  skip silently — repo secrets are never exposed to forks, and the split-workflow machinery for safe
  fork previews was deliberately rejected until outside contributors need it.
- **Preview URLs are public** (unauthenticated, not search-indexed) — accepted for a public marketing
  site; no Cloudflare Access gating.
- Previews work unmodified because assets are root-absolute (served at a `pages.dev` domain root),
  analytics stay silent off `thinkrail.ai` (the hostname gate), and canonical/OG URLs keep pointing
  at production. Drafts stay excluded — the preview shows exactly what would ship.
- **No cleanup job**: closed-PR preview deployments are inert and free; the alias just stops updating.
- Concurrency is per-PR with `cancel-in-progress: true` — the opposite of production, because a
  superseded preview has no value.

One-time setup: Cloudflare Pages project `thinkrail-previews` (`wrangler pages project create
thinkrail-previews --production-branch main`) and repo secrets `CLOUDFLARE_API_TOKEN` (Pages:Edit) +
`CLOUDFLARE_ACCOUNT_ID`.

## Blog

The `/blog` subsite is a typed Astro content collection over Markdown posts in `content/blog/`
(each post: a folder with `index.md` + optional `images/`), rendered by `src/pages/blog/` through
`src/layouts/BlogLayout.astro`.

- **Schema is the gate** (`src/content.config.ts`, zod): required `title`/`slug`/`date`, optional
  `excerpt`/`draft`/`tags`. A malformed or reserved slug, a missing field, or two posts sharing a
  slug **fails the build** — no silent green deploys. Drafts render in `astro dev` (author preview,
  hot reload) and are excluded from production builds (`src/blogCollection.ts`, the one
  query — newest-first, draft-filtered — that the index, post pages, and RSS all share).
- **URLs are directory-style** (`/blog/<slug>/`), decided while the blog was unpublished so nothing
  broke; RSS at `/blog/rss.xml` (`@astrojs/rss`). Post pages carry meta description (the excerpt),
  canonical, OG/article tags.
- **Code blocks**: Astro's built-in Shiki, dual `github-light`/`github-dark` themes emitted as
  `--shiki-light`/`--shiki-dark` CSS vars (`defaultColor: false`) so the site's `[data-theme]`
  switch — not a media query — picks the palette. Styled under `.astro-code` in `src/styles.css`.
- **YouTube embeds must be cookieless**: authors write plain iframes; the Sätteri HAST plugin
  `src/youTubeEmbeds.ts` (Astro 7's native Markdown processor — the unified/rehype pipeline is a
  separate legacy package we don't carry) rewrites `youtube.com/embed` → `youtube-nocookie.com` and
  adds `title` + `loading="lazy"` when omitted. This keeps the no-consent-banner stance intact.
- **Chrome: blog pages live inside the IDE shell**, not a separate page frame (decision, 2026-08 —
  the prior standalone blog header/footer is deleted). `BlogLayout.astro` renders through
  `IdeShell.astro`: the content sits in the same scrolling editor pane as the landing sections, in a
  `.blog-main` container sharing their exact geometry (one grouped `.file-section, .blog-main` CSS
  rule — deliberately *not* the `.file-section` class, whose typography cascade would fight the blog
  content styles). Opening an article replaces the index in that same central area. **No tab strip on
  blog pages** (the landing keeps its section tabs; page-level Landing/Blog tabs were explicitly
  rejected for now). The right rail's Files list shows the published articles (current one
  active); the terminal keeps its static install transcript — `main.ts` guards make every
  landing-only enhancement inert (no sections → no scroll-spy, no picker → no terminal replay).
  Post cards are whole-card links that signal hover on the border alone (no underline, no movement)
  and share the landing feature cards' surface, which keeps the `--elevated` tag chips visible on
  them. Theming: BaseHead (theme guard, fonts, analytics) + the `src/theme.ts` toggle via the
  shell's `main.ts` — same behavior as the landing page, one implementation.
- **Author guide**: `content/blog/BLOG.md` documents the frontmatter schema, Markdown features,
  embeds, and the local preview loop (`bun run dev` hot-reloads posts).
- **Deployment**: alongside the main site via the same `site.yml` workflow; changes to
  `apps/website/content/blog/**` trigger a rebuild.

## Assets

`public/favicon.svg` is the site tab icon: a rounded tile in the brand primary green carrying the
**header wordmark's TR mark** (same `viewBox` + paths, not redrawn) in black, centred with balanced
padding for legibility at tab sizes. It is wired via `<link rel="icon" type="image/svg+xml">` in
`index.html`; there is no `.ico` fallback.

`public/og.png` is a capture of the site's own hero inside the IDE shell (dark theme, Landing
selected, terminal install transcript finished, worktree note visible). The transcript in the
`features/agent-chat.md` section is from a real `pi` session captured in the app while it worked on
this repo. Re-capture: `astro preview` the built site, view it at a 1200×630 viewport with
deviceScaleFactor 2 (dark theme), wait for the terminal replay + the rail note (~7s), screenshot the
viewport, and downscale the 2400×1260 capture to 1200×630.
