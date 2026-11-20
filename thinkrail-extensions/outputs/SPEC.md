---
id: module-ext-outputs
type: module-design
status: draft
title: Outputs extension — the agent publishes its finished files
parent: module-thinkrail-extensions
depends-on: [module-extension-api, module-locales, module-resource-renderers]
references: [submodule-server-artifacts, submodule-web-panels, submodule-web-chat]
---

## Responsibility

The agent says which files are its deliverables. Its `present_files({ filepaths })` tool publishes
finished files from the workspace's artifacts folder; they make up the Artifacts tool's default
**Outputs** view ([[submodule-web-panels]]) and show in chat as clickable file cards. Modelled on
Claude's `present_files` and its Outputs list: an HTML mockup run leaves drafts, renders and assets
behind, and only the page the user should open belongs in front of them. On by default, switchable in
Settings → Extensions & skills; while it is off, Artifacts opens on Smart instead.

## Boundary

- `./server` default-exports `defineServerExtension({ name: "outputs", … })` with one **parent-only**
  `sessionExtensions` factory (it needs the session's `workspaceFiles`) and
  `artifactTools: { present_files: { published } }`, which hands the accepted paths to the host's
  artifact index as the stored `published` signal ([[submodule-server-artifacts]]). Imports:
  `extension-api/server`, `typebox`, pi types.
- The tool takes worktree-relative, artifacts-relative or absolute paths (`@`, `./`, `file://`
  tolerated). Each must pass `workspaceFiles.checkArtifact` — the artifact index's own rule (normalized
  containment, no links, no skipped `dist`/`node_modules`-style folders), not merely the workspace file
  check, because a file the index never lists would be "published" yet absent from Outputs. Otherwise the
  **whole call fails**, naming every refused path and why, and telling the agent to save it in the artifacts
  folder — a half-published set would leave the agent unsure what the user sees. `details.files` holds the
  names the index lists them under, deduplicated.
- `./web` registers `present_files` with `chrome: "bare"`: one card per published file (type icon,
  display name, type) opening it through `onOpenFile`; running and error states are its own. The name/type
  rule and icon come from `@thinkrail/resource-renderers` (`outputFileLabel`, `outputFileIcon`) so the
  cards and the Outputs rows never drift. Strings are `outputs.*` keys, plus the shared
  `resources.outputFile.type` ("File").

## Decisions

- **An explicit tool, not a better guess.** The host's old rule called any `.md/.html/.pdf/.svg` a result;
  on 16 real worktrees that guess made 306 of 375 results, the noise the user saw. Smart keeps the
  implicit signals (shown, linked, picked); Outputs is only what the agent declared.
- **The tool is ThinkRail's, inline here, not a `pi-extensions/` package**: it is about the artifacts folder
  and the Outputs view, which vanilla pi does not have.
- **Claude's name and shape** (`present_files`, `filepaths`): models already know when to call it.
- **Guidance rides on the tool** (`promptGuidelines`): publish what the user should open, never scratch
  work, helpers, partial versions or a deliverable's assets; only files in the artifacts folder. A
  switched-off extension therefore leaves no instruction behind. The host's own "link each result in your
  final message" rule stays — it feeds Smart.
- **Only the artifacts folder.** It is where the index, kept copies and restore already work; a project
  file the agent changed is already in Changes. Publishing elsewhere is deferred, as is un-publishing (an
  output leaves Outputs when the file is deleted).

## Verification

`server/index.test.ts` covers path forms, refusals and their message, the details reader and the
registered guidance; `web/presented.test.ts` the card list's reader. `e2e/artifacts.spec.ts` renders a
seeded `present_files` call as cards that open the file, and the Outputs view through a wire-marked
snapshot. `e2e/outputs.live.spec.ts` (`@agent`) asks a real agent for a mockup with a draft and checks
that it published only the page — one card, one Outputs row, one divider artifact.
