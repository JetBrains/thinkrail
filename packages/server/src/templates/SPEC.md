---
id: submodule-server-templates
type: submodule-design
status: active
title: templates — file CRUD over pi's prompt-template dirs
parent: module-server
depends-on: [module-contracts]
tags: [v1, templates]
---

## Responsibility

File CRUD over pi's two sanctioned prompt-template directories (global + project-scoped): list / get /
save / delete `.md` files, surfacing pi's own frontmatter (`description`, `argument-hint`) as metadata.
Consumed by the `template.*` host handlers (Task B3); this module owns no WS surface itself — `cwd` is
passed in by the caller (a resolved workspace), never looked up here.

## pi facts (pinned against pi v0.80.6 — `@earendil-works/pi-coding-agent`)

Verified by reading `dist/core/prompt-templates.js` (`loadTemplateFromFile` / `loadTemplatesFromDir` /
`loadPromptTemplates`), `dist/core/resource-loader.js` (`dedupePrompts`, `updatePromptsFromPaths`), and
`dist/utils/frontmatter.js` in the installed package — source of truth over assumption; re-verify on a
pi version bump.

- **Directories:** global = `join(agentDir, "prompts")`; project = `resolve(cwd, CONFIG_DIR_NAME,
  "prompts")` (`CONFIG_DIR_NAME = ".pi"`, pi root export) — exactly `templateDirs`'s two fields.
- **Frontmatter keys:** `description` (string) and `argument-hint` (kebab-case; pi's own loader maps it
  to a camelCase `argumentHint` field via `...(frontmatter["argument-hint"] && { argumentHint:
  frontmatter["argument-hint"] })`). No other frontmatter keys are read by pi's loader.
- **Name derivation:** `basename(filePath).replace(/\.md$/, "")` — filename minus a trailing `.md`
  suffix, once (a name with an embedded dot like `foo.bar.md` derives `foo.bar`).
- **No name validation in pi's loader, at all.** `loadTemplatesFromDir` accepts any directory entry
  where `entry.isFile()` (or a symlink resolving to a file) `&& entry.name.endsWith(".md")` — no regex,
  no traversal guard, and no dot-leading filter either (pi would list a hand-placed `.hidden.md`).
  Path-traversal safety for **our** by-name paths (`saveTemplate` / `getTemplate` / `deleteTemplate`) is
  entirely this module's own `isValidTemplateName` gate; pi gives us nothing to lean on there.
- **`loadTemplatesFromDir`'s error handling is two-layered, at two different granularities.** The whole
  `readdirSync` call plus the loop around it sits inside one `try { … } catch { return templates; }` — an
  unreadable directory returns whatever had already been collected rather than throwing out of the
  function. Independently, each file goes through `loadTemplateFromFile`, which has its *own* inner
  `try { … } catch { return null; }` around the read + `parseFrontmatter` + object-build. This module's
  `listDir` mirrors both layers (see "Design" below) — the whole-scan wrapper is what protects
  `listTemplates` from an EACCES (or similar) blanking every scope's results, not just the bad one's.
- **`parseFrontmatter`'s real signature** (`dist/utils/frontmatter.d.ts`): `parseFrontmatter<T extends
  Record<string, unknown> = Record<string, unknown>>(content: string): { frontmatter: T; body: string
  }` — a plain sync function, generic over the frontmatter shape (unvalidated at runtime; the generic
  is the caller's own assertion, exactly as pi's own loader trusts it). We use the default
  `Record<string, unknown>` and narrow with `typeof` before trusting a value as a `string`.
- **No-frontmatter files parse to `{ frontmatter: {}, body: <normalized content> }`.** Reading
  `frontmatter.js` itself: newlines are normalized (`\r\n`/`\r` → `\n`) first; if the content doesn't
  start with `"---"`, or a `"---"` opener never finds a closing `"\n---"`, the whole (normalized)
  content becomes `body`, un-trimmed. Only a *successfully closed* frontmatter block yields a `body`
  that's `.trim()`ed. This module never reads pi's `body` at all (see "content" below), so none of that
  trim/normalize behavior leaks into `TemplateInfo` — it only matters for the description-extraction
  path, and even there we don't lean on it.
- **pi's loader synthesizes a fallback `description`** from the body's first non-empty line (truncated
  to 60 chars + `"…"`) when frontmatter has none — used for pi's own `/` menu blurbs. We deliberately do
  **not** replicate this: `TemplateInfo.description` is optional on the wire (`contracts/domain.ts`), so
  a template with no `description` frontmatter key surfaces `description: undefined` (key omitted),
  never a manufactured value pi never wrote to disk.
- **Precedence is not decided inside `loadPromptTemplates` itself.** Its `includeDefaults` branch just
  concatenates `[...global, ...project]` with **no dedup at all** at that layer. Real precedence is
  resolved later, in `resource-loader.js`'s `dedupePrompts` — a `Map` keyed by name where the **first**
  prompt registered for a name wins (subsequent same-name entries become a `collision` diagnostic, not
  an overwrite) — over a `promptPaths` list built from project config merge order we did not trace
  further (out of this module's bounded investigation, and irrelevant: none of `loadPromptTemplates` /
  `dedupePrompts` is root-exported — the sealed exports map gives us only `parseFrontmatter` /
  `stripFrontmatter` / `getAgentDir` / `CONFIG_DIR_NAME`, so we can't call pi's version even if we
  wanted to). **"Project shadows global" here is our own product decision** (design spec §2.2, "scope
  omitted → pi precedence: project wins over global" — matching the brief), implemented independently
  in `listTemplates`/`getTemplate` with a `Map` keyed by name where global is inserted first and project
  second (`Map.set` on an existing key overwrites the value) — the mirror image of pi's own first-wins
  `dedupePrompts`, chosen deliberately because "more specific scope wins" is the behavior the product
  spec calls for, not because pi's internals resolve it that way for us.
- **`stripFrontmatter` (also root-exported) is not used by this module.** `TemplateInfo.content` is "the
  full file text: frontmatter + body" (`contracts/domain.ts`), and design spec §2.4 confirms it end to
  end: "The client assembles the markdown (frontmatter + body); the server writes it verbatim." So
  `content` is always the raw `readFileSync` result — never pi's parsed/stripped `body` — and
  `stripFrontmatter` has no field to feed. (A later task's slot parser, over in `apps/web`, will need
  its own tiny non-pi frontmatter strip if it wants pi's `body` shape — it can't import pi's at all,
  browser-bundled code included, per the root architecture invariant.)

## Design

- `templateDirs(cwd?, agentDir = getAgentDir())` → `{ globalDir, projectDir? }` — pure path arithmetic,
  no filesystem access. `agentDir`'s default is a **default-parameter expression**, evaluated at call
  time, not a module-level constant — `getAgentDir()` reads `PI_CODING_AGENT_DIR` live (history/SPEC.md
  pins this same fact for pi's `SessionManager` path), so caching it at import time would go stale the
  moment a test (or the e2e seeder) sets the env var after this module has already loaded.
- `listTemplates` re-reads both directories **on every call** — no cache, anywhere in this module. This
  is the "/ menu freshness" rule (design spec §2.2): pi's own `session.promptTemplates` getter reads
  through `ResourceLoader.getPrompts()`, populated once at session load and only refreshed by an
  explicit resource reload — a **create-time snapshot** that goes stale the moment a template is saved
  mid-session (confirmed by reading `agent-session.js`'s `get promptTemplates()` /
  `resource-loader.js`'s `updatePromptsFromPaths`). A template saved through `template.save` must show
  up the next time any client asks (`template.list`, the web `/` menu, the Templates settings panel), so
  this module never memoizes; the cost is a couple of small `readdir`s per call, which is cheap enough.
- `isValidTemplateName` is the **traversal gate**: applied to every caller-supplied `name` before it's
  `join()`-ed into a path, in `getTemplate`, `saveTemplate`, and `deleteTemplate` alike. Its job is
  path-traversal *safety*, not naming style, so it rejects only the shapes that are unsafe as a single
  filename segment — empty, a leading `.` (covers `.`, `..`, and `.hidden`-style dotfiles with one rule),
  a path separator anywhere in the name (`/` or `\`), or an embedded NUL byte — and accepts everything
  else, including interior dots (`foo.bar`), uppercase, spaces, and unicode. This matters because pi's
  own loader performs **no sanitization at all** when deriving a name from a filename (see "pi facts"
  above), so a narrower rule breaks **list/get parity**: a name `listTemplates` can show but
  `getTemplate`/`saveTemplate`/`deleteTemplate` refuse is a user-visible bug, not a safety improvement.
  (This gate originally used an `/^[a-z0-9][a-z0-9-_]*$/i` allowlist regex — safe, but over-restrictive:
  it rejected any name with an interior dot, so a perfectly ordinary, pi-legal template named `foo.bar`
  would list but 404 on get/save/delete. Fixed once caught — the allowlist shape was solving the wrong
  problem, aesthetics instead of traversal.) `listTemplates` (via `listDir`) **does** filter by this
  exact gate — not to mirror pi (pi's own scanner has no such filter and would happily list a hand-placed
  `.hidden.md`), but so list/get parity holds *structurally*: reusing the very predicate that guards
  get/save/delete, rather than a hand-rolled dot-check that could quietly drift from it later, means any
  name the gate rejects is invisible to `listTemplates` too, not just un-fetchable through it. (This
  filter was itself a fix: an earlier version listed every `.md` file unconditionally, so a hand-placed
  `.hidden.md` would show up in `template.list` and then 404 on `template.get`.)
- **The no-follow gate (symlink containment):** the traversal gate above constrains the *name*; this one
  constrains what the name may *resolve to*. Every by-name operation `lstat`s the target (never
  following) and treats anything that isn't a regular file — a symlink first of all — as **not a
  template**: `getTemplate` reports it absent, `saveTemplate` refuses to write through it (loud error,
  nothing touched on disk), `deleteTemplate` reports it not-found; `listDir` already skips symlinks
  structurally (a symlink dirent's `isFile()` is false, and no follow-up `stat` is taken). This is a
  **deliberate divergence from pi's own scanner**, which explicitly follows a file symlink
  (`loadTemplatesFromDir` stats it and loads a file target — "pi facts" above): pi's loader is a
  read-only, local convenience, while this module is a *write-capable CRUD surface over the wire* —
  following `.pi/prompts/linked.md → ~/somewhere` would let `template.get` disclose the target and
  `template.save` overwrite it, so a checked-out repo could plant a link and turn a routine template
  edit into a file write outside the worktree. Cost: a legitimately symlinked individual template that
  pi's own `/` menu would offer doesn't appear in ThinkRail's — acceptable, and already the listing's
  behavior before this gate existed. **Project-scope writes** additionally refuse to operate through a
  symlinked `<cwd>/.pi` or `<cwd>/.pi/prompts` *directory* (the same escape one level up — the repo
  controls those path components); the **global** dir is exempt on purpose: `~/.pi/agent/prompts` is
  user-owned (an attacker writing there has already won) and dotfile managers routinely symlink it. The
  `lstat`-then-write gap is a TOCTOU race only a concurrent local process could exploit — out of scope
  for an owner-scoped host (such a process could write the target directly). Pinned by the symlink
  cases in `templates.test.ts`.
- Two layers of failure containment inside `listDir` (the directory scan `listTemplates` calls twice),
  each mirroring a different pi behavior at a different granularity: **(1)** a per-file read/parse
  failure (unreadable file, malformed YAML frontmatter) is caught and that one file is skipped — mirrors
  pi's own `loadTemplateFromFile`'s `try { … } catch { return null; }`. **(2)** the *directory scan
  itself* — the `readdirSync` call plus the loop around it — is also wrapped, so an unreadable directory
  (EACCES, or, deterministically, a path that turns out not to be a directory at all) returns whatever
  had already been collected instead of throwing out of `listTemplates` entirely — mirrors pi's own
  `loadTemplatesFromDir`, whose try/catch wraps the *whole* scan, not just each file. (Layer (2) was
  itself a fix: an earlier version had only layer (1), so an unreadable directory propagated straight
  through `listTemplates` and could blank the *other* scope's results too, not just the bad one's.)
  `getTemplate` makes no such allowance for a *directly named* file: a parse failure there propagates,
  since the caller asked for that one file specifically and deserves to know something's wrong with it
  (covered by a dedicated test — the documented asymmetry against `listTemplates`'s swallow).
- `saveTemplate` parses the incoming `content`'s frontmatter *before* writing anything. Building the
  return value already called `parseFrontmatter` via `readTemplateFile` after the write — which meant a
  syntactically-invalid `---`-fenced block would land the file on disk and *then* throw, orphaning a file
  that's invisible to `listTemplates` (layer (1) above swallows it) and un-`get`-able (propagates there,
  by design) — present on disk but unreachable through this module. Validating first turns a rejected
  save into a no-op on the filesystem: nothing is written, `mkdirSync`/`writeFileSync` never run. The
  read-back after a successful write can in principle still fail, but only for a filesystem race at that
  point, not a content problem — an acceptable residual this function doesn't try to eliminate.
- `listTemplates`'s result is sorted by `name` — `readdir` order isn't guaranteed across platforms, and
  every consumer of a template *list* (the `/` menu, the Templates settings panel) wants a stable order
  more than it wants filesystem-arrival order.

## Boundary

- **Owns:** file CRUD in exactly the two sanctioned dirs (`TemplateDirs.globalDir` / `.projectDir`);
  name validation as the traversal gate; frontmatter → metadata extraction for `description` /
  `argumentHint`. Never touches any other path — no `resolvePath` / symlink-following of caller input,
  only `join(dir, \`${name}.md\`)` after `name` has passed `isValidTemplateName`.
- **Public surface (barrel):** `templateDirs`, `TemplateDirs`, `listTemplates`, `getTemplate`,
  `saveTemplate`, `deleteTemplate`, `isValidTemplateName`.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (`getAgentDir`, `CONFIG_DIR_NAME`,
  `parseFrontmatter` — root exports only), `@thinkrail/contracts` (`TemplateInfo`, `TemplateScope`),
  `node:fs`, `node:path`.
- **Forbidden:** importing `workspaces` / `projects` — stays registry-free like `history`; the
  `template.*` handler resolves `workspaceId` → `cwd` and passes `cwd` into `templateDirs` itself.
  Caching the listing across calls. Writing or reading anything outside `globalDir` / `projectDir`.

## Get right

- **`content` is the full file text, not pi's parsed `body`.** `TemplateInfo.content` round-trips
  byte-for-byte through `saveTemplate` → disk → `getTemplate` / `listTemplates`, independent of
  `parseFrontmatter`'s trim/newline-normalization quirks — those only ever affect metadata extraction,
  never the `content` field.
- **Fresh read, every call.** No in-memory cache anywhere in this module (see "Design" above) — this is
  deliberate, not an oversight; don't add one without re-reading the freshness rationale it exists to
  satisfy.
- **List/get parity, both directions — structural, not a convention.** `isValidTemplateName` excludes
  only the shapes that are unsafe as a filename segment (empty, leading `.`, a separator, NUL), never an
  ordinary pi-legal name like `foo.bar` — so don't tighten it without checking it still admits everything
  pi's own loader would list (a narrower "clean slug" regex looks safe in review but silently breaks
  this; it did, once — see "Design" above). The reverse direction holds too, by construction: `listDir`
  filters every directory entry through this *exact same* gate function, not a partial or hand-rolled
  re-check, so a dot-leading file like a hand-placed `.hidden.md` is ignored by the scan entirely and
  never surfaces in `listTemplates` in the first place. The gate and the scan can't drift apart because
  they share one predicate — don't reintroduce a second, parallel check for either direction.
- **`deleteTemplate` throws when the target is already gone**, rather than treating a missing file as a
  successful no-op — this is the handler contract Task B3 should build on. A delete request only reaches
  this module because a caller's UI named one specific existing-as-far-as-it-knows template; if the file
  is already gone, that view is stale, and the `template.*` handler should surface that as an error (e.g.
  "already deleted, refresh") rather than reporting success for something that didn't happen. Loud beats
  silent for a stale UI.
