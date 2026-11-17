---
id: submodule-server-wiki
type: submodule-design
status: active
title: wiki — repo knowledge-graph wiki (Graphify) and GitHub Pages publish
parent: module-server
depends-on: [module-contracts]
tags: [wiki, graphify, github-pages, public-surface-checked]
---

## Responsibility

Serve the Repository wiki page and own everything specific to it: read the wiki a Graphify run left in the
worktree, hand the web the prompt that tasks the `wiki-builder` subagent, and publish the wiki to GitHub
Pages. The module never runs Graphify and never talks to a model — building is an agent turn the user
watches in a chat; publishing is a deterministic git push.

## Boundary

- **Owns:**
  - **The wiki on disk.** Graphify writes `graphify-out/wiki/*.md` (flat articles, `index.md` as entry,
    relative `.md` links) into the worktree. `wikiStatus(workspaceId)` lists the articles (entry first, then
    by title in numeric order; title = the first `#` heading) and answers `built` only when `index.md`
    exists; `builtAt` is its mtime. `wikiPage(workspaceId, path)` reads one article, refusing anything but a
    root-relative POSIX `.md` path that stays inside the wiki after symlink resolution, and anything over
    2 MiB. Generated output stays out of the worktree's git status: `prepareWikiBuild` drops a
    `graphify-out/.gitignore` containing `*`.
  - **The build prompt.** `prepareWikiBuild(workspaceId, model, codeOnly)` validates the model reference
    (`provider/id`, one printable line) and returns the chat prompt. The prompt tells the chat's agent to make
    exactly one foreground `Agent({ subagent_type: "wiki-builder", model, task })` call. **The model is chosen
    per call, never pinned in the definition**, so two workspaces with different models never race on one
    shared file, and a custom endpoint is just a provider in the model reference. The subagent's definition
    (`WIKI_BUILDER_DEFINITION`, a pi personal-agent file carrying `WIKI_BUILDER_MARKER`) is installed by `host`
    through `agent`'s `ensureManagedAgentDefinition`, which never overwrites a file without the marker.
  - **The Graphify recipe** in that definition: install `graphifyy` when missing, `graphify extract . --code-only`
    (local AST, no LLM; the full extraction needs a Graphify backend from the environment, for example
    `OPENAI_BASE_URL` + `OPENAI_MODEL`, and falls back to code-only), `graphify cluster-only . --no-label --no-viz`,
    the agent writes `graphify-out/.graphify_labels.json` (community number → name, for the 30 largest) itself, then
    `graphify export wiki --labels …`. Graphify has no documented wiki command that needs a model of its own,
    which is why the naming step belongs to the subagent.
  - **Publishing.** `publishWiki(workspaceId)` builds a Jekyll source (`site.ts`: every article with front
    matter and `{% raw %}`, `.md` links rewritten to `.html`, `_config.yml` with `jekyll-theme-minimal`, and the
    `.thinkrail-wiki` ownership marker) and replaces the **`gh-pages`** branch of origin with one commit of it
    (`publish.ts`, from a temp dir, never from the worktree). It then enables Pages on that branch through
    `gh api` when Pages is not enabled yet and records `{ url, branch, publishedAt }` in
    `graphify-out/.thinkrail-wiki.json`.
- **Publish safety.**
  - Origin must be a GitHub remote (`WIKI_NOT_GITHUB`) and the wiki built (`WIKI_NOT_BUILT`).
  - A `gh-pages` branch whose tip lacks the marker file was not written by this module and is **never
    overwritten** (`WIKI_BRANCH_FOREIGN`). The same code answers a repo whose Pages already serves a different
    branch, checked before anything is pushed.
  - The push is a force push, which is safe only because of the marker check above.
  - Git and `gh` run under the same bounded, prompt-disabled runners as the rest of the host; a failed step is
    `WIKI_PUBLISH_FAILED` with the step name and stderr, remote credentials stripped.
  - Enabling Pages can fail for lack of admin rights; the branch is still published and the URL falls back to
    `https://<owner>.github.io/<repo>/`.
- **Public surface (barrel):** `prepareWikiBuild`, `publishWiki`, `wikiPage`, `wikiStatus`,
  `WIKI_PUBLISH_BRANCH`, `WIKI_BUILDER_AGENT`, `WIKI_BUILDER_DEFINITION`, `WIKI_BUILDER_MARKER`.
- **Allowed deps:** `persistence` (workspace lookup), `git` (`gitAsync`: origin URL and the publish push),
  `branch-review` (`githubSlug`, `runProviderCommand` for `gh api`), contracts types, `shared/codedError`; Node.
- **Forbidden:** `host`; `agent` and any pi package (the definition file is installed by `host`); sibling
  features; browser code; writing anywhere in the worktree but `graphify-out/`.

## Get right

- Publishing is outward-facing and replaces a branch. The web asks for confirmation naming the repository
  before it calls `wiki.publish`, and nothing here publishes as a side effect of a build.
- The wiki is derived output. Status and page reads are pull-only and cheap (a directory walk plus the first
  kilobyte of each article); nothing is cached, so a rebuild is visible on the next read.
- A published site lags the local wiki until the next publish; `WikiStatus.publication` is the last publish,
  not a claim about what is live.
