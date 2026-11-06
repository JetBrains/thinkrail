# oh-my-thinkrail

A fork of [ThinkRail](https://github.com/JetBrains/thinkrail), adapted for the **Tomato workflow** and
issue-centered development collaboration.

The goal is to use **GitHub and GitLab Issues as durable records of key session decisions and
summaries**, so people and agents can resume work without depending on a single chat history or
machine. Issues capture goals, design decisions, progress, verification results, and handoffs—not full
chat transcripts or private reasoning.

This fork explores more efficient ways to collaborate across design, implementation, and review,
while retaining ThinkRail's [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)-based
sessions and isolated Git worktrees.

## Current scope

Issues integration is experimental and covers GitLab and GitHub repositories. The provider follows the
repository address — only `github.com` is GitHub, every other host is GitLab — and both use an access
token. It includes:

- HTTP(S) project association from the Issues panel or after opening or cloning a repository.
- Personal access tokens stored in the host's OS credential vault, with explicit consent for non-local
  HTTP connections and no plaintext storage fallback.
- An issue list with **Design** and **Implement** actions. Sessions use the Issue title; implementation
  creates or reuses an owned `.worktrees/issue-<IID>` workspace. The two activities can interleave.
- New Issue sessions load the built-in Tomato workflow skill and start once with the Issue body and
  complete comments, using the effective interface language. Reopening a session only opens its history.
  Session-bound tools read current Issue context and publish deliberate summaries without exposing tokens.
  The skill requires confirmed summary publication before handoff; automatic turn-end posting is not enforced.

Starting implementation does not require design approval and does not change Issue labels. Approval
and Issue closure remain in the tracker. Automated push/MR/CI/merge delivery is not implemented.

Reads, listing, Issue sessions and summary publication work on both providers with identical issue and
label presentation. Approval receipts, design/implementation publication and merge stay GitLab-only for
now and are refused on GitHub; GitHub Enterprise Server and complete cross-machine handoffs remain
project goals. Existing upstream GitHub pull-request features are separate from Issues integration.

## Windows Desktop releases

Run **Actions → Release Windows desktop → Run workflow** and select the branch to build (the
workflow must first be merged into the default branch to appear there). It builds only Windows x64
Desktop and publishes the installer to this repository's [Releases](https://github.com/caozisheng/oh-my-thinkrail/releases)
after expanded-app and installer smoke checks pass.

Versions use the latest official `JetBrains/thinkrail` Release plus the first eight characters of
this fork's build commit, for example `0.3.2.abcdef01`. The installer is
`oh-my-thinkrail-<version>-windows-x64.zip`; `SHA256SUMS` and `build-info.json` record its checksum,
full fork commit and upstream version provenance. The upstream version is a label, not a guarantee
that this fork contains every change in that upstream release. Existing tags/releases are never overwritten.

These are **unsigned, independent fork builds**, not JetBrains-signed distributions. Windows
SmartScreen may warn. Extract the complete ZIP and keep the setup EXE beside its payload when running
setup. Automatic desktop updates are disabled; install subsequent releases manually. Release builds
carry no upstream PostHog project key. Source-run privacy behavior is unchanged below.

## Development

Use the Bun version pinned in `package.json`, Node.js **22.19+**, and Git. Agent sessions also need a
configured model provider.

```bash
git clone https://github.com/caozisheng/oh-my-thinkrail.git
cd oh-my-thinkrail
bun install
bun run dev
```

Fork application state defaults to **`~/.oh-my-thinkrail`**, separate from upstream's `~/.thinkrail`.
Existing upstream state is not automatically migrated. `THINKRAIL_DATA_DIR` overrides this location.
Pi configuration still defaults to `~/.pi/agent`; use `PI_CODING_AGENT_DIR` to isolate it as well.

Unsigned Windows preview builds are available from successful
[Preview artifacts workflow runs](https://github.com/caozisheng/oh-my-thinkrail/actions/workflows/build-preview.yml).
These are CI artifacts, not signed releases.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development details and
[architecture.md](architecture.md) for module boundaries and design decisions.

## Privacy

Issues are intended for deliberate summaries and handoffs, never credentials or full conversation
exports. Upstream telemetry behavior has not been removed: basic usage analytics and classifier-only
error reporting remain enabled; additional sharing is controlled in **Settings → Privacy**.

## Acknowledgments and license

Built on [ThinkRail](https://github.com/JetBrains/thinkrail) and the pi coding agent. This fork is an
independent project, not an official JetBrains distribution.

Licensed under the [Apache License 2.0](LICENSE).
