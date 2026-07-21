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
  no traversal guard. Path-traversal safety for **our** by-name paths (`saveTemplate` / `getTemplate` /
  `deleteTemplate`) is entirely this module's own `isValidTemplateName` gate; pi gives us nothing to
  lean on there.
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
- `isValidTemplateName` (`/^[a-z0-9][a-z0-9-_]*$/i`) is the **traversal gate**: applied to every
  caller-supplied `name` before it's `join()`-ed into a path, in `getTemplate`, `saveTemplate`, and
  `deleteTemplate` alike. It rejects anything containing `/`, a leading `.` (so `.`, `..`, and `.hidden`
  all fail the first-character class), or an empty string. `listTemplates` does **not** filter by it —
  it enumerates whatever `.md` files already exist in the sanctioned dirs, matching pi's own
  no-validation scan, so a file placed there by another tool with an unusual name still surfaces for
  reading; it just can't be *targeted* by name through this module unless its derived name happens to
  satisfy the gate too.
- A per-file read/parse failure (unreadable file, malformed YAML frontmatter) is swallowed inside
  `listTemplates`'s directory scan — one bad file must never blank the whole listing — mirroring pi's
  own `loadTemplateFromFile`'s `try { … } catch { return null; }`. `getTemplate` / `saveTemplate` make no
  such allowance for a *directly named* file: a parse failure there propagates, since the caller asked
  for that one file specifically and deserves to know something's wrong with it.
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
