---
id: module-website
type: module-design
status: active
title: Project website (thinkrail.ai)
parent: architecture
tags: [website, marketing]
depends-on: [module-website-analytics]
---

## Responsibility

The project's public website at `thinkrail.ai`: the IDE-shell landing, its blog, and the audience-specific
vibecoding experience at `/vibecoding/`. The landing and blog's creative conceit is that **the site IS
the IDE**: a faithful HTML/CSS recreation of the ThinkRail shell (title bar, project rail, tab strip,
files rail, terminal, status bar) whose center "editor" is the normally-scrolling page content. Each
landing section poses as a file of a `website` workspace (`README.md`, `why.md`, `features/*.md`,
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

`/vibecoding/` deliberately uses a separate visual grammar: [[submodule-website-vibecoding]] owns the
animated product story and install experience as a route-local React island with route-local Tailwind.
It shares the website origin, artifact, analytics initializer, SEO outputs, and deployment—not the
IDE-shell presentation.

Not part of the product: nothing in the app depends on the public website, and it never ships in the
binary.

## Boundary

- **Independently deployed leaf.** Its only workspace dependency is [[module-website-analytics]]; it
  must never import contracts, server, shared, or web. It is not on the wire and has no protocol
  knowledge.
- **One static Astro artifact, with a route-local framework exception.** The landing and blog retain
  vanilla TypeScript + hand-written CSS: no React island and no Tailwind stylesheet or runtime reaches
  those routes. [[submodule-website-vibecoding]] alone may use one React island and Tailwind v4. Astro's
  React integration and Tailwind Vite plugin are build-wide tooling, but generated page references are
  the runtime boundary; package build validation fails if unrelated routes reference the island renderer,
  component chunks, or vibecoding stylesheet. The browser analytics workspace module is compiled into
  the static output. The `@fontsource-variable/*` packages are build-time asset sources: the build emits
  their woff2 files into `dist/`. They are shared with `apps/web`, so they come from the root
  `workspaces.catalog` — one pin for both apps, which is what keeps the site's faces identical to the
  app's.
  - *Why Astro (decision, 2026-08):* the blog + planned docs fired the "bespoke SSG" tripwires
    (RSS, OG, typed frontmatter, content DX). Astro is Vite underneath — the landing page ported
    verbatim, `bun test` suites unchanged — and React 19 islands are available only where a route needs
    one. Rejected: Next.js static export (ships the React runtime to static pages, non-Vite culture),
    VitePress (Vue), Eleventy (docs features assemble-yourself — the bespoke trap again), Hugo/Zola
    (non-TS toolchain, token/tests integration lost). The prior bespoke pipeline
    (`scripts/build-blog.ts` + HTML string templates) is deleted.
  - *Lint caveat:* Biome parses only `.astro` frontmatter, so `noUnusedVariables`/`noUnusedImports`
    are disabled for `*.astro` in `biome.json` (template usage is invisible to it — every flag would
    be a false positive). `astro check` covers the templates instead.

The parent owns the route-composition edges; the vibecoding leaf has no sibling dependency:

```text
src/pages/vibecoding/index.astro ──▶ src/vibecoding (through index.ts)
src/pages/vibecoding/index.astro ──▶ src/components/Analytics.astro
landing + blog shells             ──▶ src/components/Analytics.astro
```

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
- **IDE-shell page chrome is single-sourced in components.** `src/components/BaseHead.astro` is the one
  head the landing and blog use: charset/viewport, favicon, their global stylesheet (which bundles the
  fonts), and the pre-paint theme guard. `src/components/Analytics.astro` is presentation-free and is
  included once by every route family. `src/components/IdeShell.astro` is the one IDE shell the landing
  and blog render through — icon sprite, skip link, title bar (workspace name
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

## Analytics and consent

`src/analytics.ts` is the site-local facade over [[module-website-analytics]]. It supplies the exact
production hostname `thinkrail.ai`; the shared module owns the PostHog and GTM identifiers, privacy
configuration, and typed script loaders. Localhost, `astro dev`, every `pages.dev` deployment, the
`jetbrains.github.io` address, and sibling subdomains send nothing.

`src/components/Analytics.astro` initializes that facade once per document and is the only analytics
composition point for the IDE-shell and vibecoding routes. No page or child module carries vendor
configuration or another loader. The existing GTM container remains Cookiebot's control plane; route-
specific downstream tags use a `thinkrail.ai` hostname condition plus Page Path, never another GTM
container. Sharing the exact apex origin means Cookiebot scans and browser consent state apply to all
three route families.

The site test pins its production-host identity and disabled hosts, while the shared package tests the
common PostHog/GTM contract. The shared contract deliberately has no `posthog-js` dependency, pasted
bootstrap, or static GTM `noscript` iframe; its spec owns the cookieless behavior and consent caveat.

## Deploy

Cloudflare Pages project `thinkrail-website` owns production and previews for the one static artifact.
`.github/workflows/site.yml` runs `bun run --filter @thinkrail/website build` (`astro check && astro
build` plus artifact validation) and direct-uploads `apps/website/dist` to branch `main` on pushes that
touch this module, [[module-website-analytics]], the root package manifest, or the lockfile (plus manual
dispatch). It verifies the provider URL before succeeding. `thinkrail.ai` is the project's custom apex
domain; provider URLs are deployment probes, not product identities.

Production concurrency never cancels an in-flight publish. Cloudflare retains successful production
deployments as rollback targets, so rollback selects the prior `main` deployment instead of running a
second hosting pipeline.

### PR preview deploys

`.github/workflows/site-preview.yml` runs the same build command and uploads to branch `pr-<number>` in
`thinkrail-website`. The deterministic alias `https://pr-<number>.thinkrail-website.pages.dev` is
surfaced as one sticky PR comment and one `Website preview` commit status covering `/`, `/blog/`, and
`/vibecoding/`. It waits for all three route families to serve before publishing the URL.

Same-repository PRs only receive previews; fork PRs skip because Cloudflare credentials never cross the
repository boundary. Preview URLs are public and analytics-silent while their PR is open. A separate
close workflow recognizes the sticky preview marker, deletes every deployment for that PR branch, and
marks its preview metadata retired; PRs without that marker are no-ops. The shared concurrency group
prevents cleanup racing an in-flight publish. A newer push cancels only the superseded preview for that
PR.

One-time setup creates `thinkrail-website` with production branch `main`, using the existing
`CLOUDFLARE_API_TOKEN` (Pages:Edit) and `CLOUDFLARE_ACCOUNT_ID` repository secrets, then attaches the
`thinkrail.ai` custom domain after the provider-hosted main deployment is verified.

### Hosting and retired hostname

Cloudflare-managed DNS routes `thinkrail.ai` to the verified `main` deployment. Production rollback
selects a prior successful `main` deployment through Pages; legacy hosting is not part of the steady
state.

`vibecoding.thinkrail.ai` is a Cloudflare Single Redirect: hostname match, dynamic target
`concat("https://thinkrail.ai/vibecoding", http.request.uri.path)`, status 301, and query preservation
enabled. Its originless proxied `192.0.2.1` record keeps the redirect resolvable without a deployment.

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
  them. Theming: BaseHead (theme guard + fonts) + the `src/theme.ts` toggle via the shell's `main.ts`
  — same behavior as the landing page, one implementation; Analytics remains the separate shared head
  initializer.
- **Author guide**: `content/blog/BLOG.md` documents the frontmatter schema, Markdown features,
  embeds, and the local preview loop (`bun run dev` hot-reloads posts).
- **Deployment**: alongside the main site via the same `site.yml` workflow; changes to
  `apps/website/content/blog/**` trigger a rebuild.

## Discovery and assets

One apex `robots.txt` allows the public site and points crawlers at Astro's generated sitemap. The
sitemap derives from the same static route build and therefore covers `/`, the blog index and published
posts, and `/vibecoding/`; previews keep production canonical URLs and do not become a second search
identity.

`public/favicon.svg` is the IDE-shell landing/blog tab icon: a rounded tile in the brand primary green carrying the
**header wordmark's TR mark** (same `viewBox` + paths, not redrawn) in black, centred with balanced
padding for legibility at tab sizes. It is wired via `<link rel="icon" type="image/svg+xml">` in
`index.html`; there is no `.ico` fallback.

`public/og.png` is a capture of the site's own hero inside the IDE shell (dark theme, Landing
selected, terminal install transcript finished, worktree note visible). The transcript in the
`features/agent-chat.md` section is from a real `pi` session captured in the app while it worked on
this repo. Re-capture: `astro preview` the built site, view it at a 1200×630 viewport with
deviceScaleFactor 2 (dark theme), wait for the terminal replay + the rail note (~7s), screenshot the
viewport, and downscale the 2400×1260 capture to 1200×630.

`public/vibecoding/` owns that route's distinct favicon, 1200×630 Open Graph image, and gradient
wordmark. Their public URLs remain under `/vibecoding/`, while Vite-generated chunks stay under the
site-wide `/_astro/` root because one Astro base serves all route families.
