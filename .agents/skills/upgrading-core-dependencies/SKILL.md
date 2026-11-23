---
name: upgrading-core-dependencies
description: "Use when upgrading a ThinkRail core dependency, i.e. one the host works around and tracks in a compatibility registry (for example pi or Electrobun/Hutch), or when asked to update core dependencies without naming one. Not for routine bumps of other packages."
---

# Upgrading a core dependency

A core dependency is one the host compensates for: ThinkRail keeps a compatibility registry of the
workarounds for it, each with a removal gate. An upgrade does more than bump a version: it re-checks
every registry entry against the newly installed code, deletes what upstream now covers, adapts to
what moved, and ships one PR that records the evidence.

This file is the procedure shared by every core dependency. The dependency-specific mechanics (where
it is pinned, how to diff it, which mirrors follow it, how to verify it) live in a **playbook** under
`playbooks/` next to this file. There is no fixed list of playbooks: discover them.

## 1. Pick the dependency

1. **Discover playbooks.** List `playbooks/*.md` in this skill's directory and read each one's
   frontmatter:
   - `dependency`: the short name;
   - `packages`: the package names it covers;
   - `registry`: its compatibility registry, relative to the repo root;
   - `current`: where the pinned version is read;
   - `latest`: how to look up the newest release.
2. **Match the ask.** When the user names a dependency or package, match it against `dependency` and
   `packages`.
3. **No dependency named, or the name is ambiguous.** For each playbook, read the current pin and
   look up the latest release. Then ask with `ask_user_question`, one option per playbook in the form
   `<dependency>: <current> → <latest>` (or "up to date"). Recommend the one furthest behind, or the one
   with a pending fix the user mentioned. Upgrade one dependency per PR; when the user picks several,
   do them one after another as separate PRs or offer separate workspaces.
4. **Named, but no playbook.** Ask whether this is a routine bump (then this skill does not apply:
   bump it, run the affected tests, ship) or a new core dependency. A new core dependency gets a
   playbook (see *Adding a playbook*) and, once the host first works around it, a registry. Never
   treat a missing playbook as permission to skip the registry re-check.

Then read the playbook's registry in full and the playbook itself. The registry is the source of
truth for the entries and their gates; neither this skill nor a playbook restates them.

## Ground rules

- **Installed code is the evidence.** Check each gate against the installed package's exports and
  implementation, or the upstream source at the release tag, not against release notes or an issue's
  open/closed state. Changelogs tell you where to look; they do not close a gate.
- **A parity or regression failure means drift.** It is not permission to weaken, skip, or re-baseline
  the test. Find what upstream changed, then follow it, port the workaround, or stop and ask.
- **Upstream defaults that change product behavior are the user's decision.** A new default that
  spends tokens or money, changes what users see, or moves their defaults (pi 1.5.1's idle cache
  warming is the canonical case) goes to the user through `ask_user_question` with a recommendation
  before you adopt or neutralize it.
- **Walk intermediate releases.** When the range spans several releases, read every changelog in
  between. Re-checks may be done once against the target, but name the release that changed each
  thing.
- **Spec first for boundary changes.** A new or removed workaround updates its owning module spec and
  the registry in the same PR (the registry's *Upgrade contract* says how).
- **No suppressions to get green.** The repo-wide hygiene rules in `AGENTS.md` apply in full.

## 2. Procedure

Track it as a TODO plan; these phases make a good skeleton. The playbook fills in each phase.

1. **Scope.** Record the current pin and pick the target, by default the latest stable release. Read
   the changelog for every release in the range and list what touches the host: changed or removed
   exports the host imports, behavior behind a registry entry, new defaults, catalogue/platform
   changes, fixes users will notice. Raise the product decisions now, not after the bump.
2. **Bump.** Change the pin(s) and reinstall with the Bun pinned in the root `packageManager`. The
   lockfile delta should contain only the upgraded packages and their own dependency changes; read it
   before going further.
3. **Re-check every registry entry.** For each entry, record one outcome with its evidence:
   - **met**: delete the workaround, its tests (unless they still state the product contract) and its
     registry entry, and add a short post-mortem in the owning spec;
   - **retained**: the evidence (the private symbol still unexported, the defect still reproduces, the
     unchanged code path);
   - **changed**: the workaround or mirror followed upstream; say what moved;
   - **added**: a new workaround this release forces, with an entry and a removal gate.
   Run the tests each entry names. Also check the registry's *Not temporary workarounds* and
   accepted-gap lists: an upgrade never removes those silently.
4. **Adapt.** Fix what the bump broke (types, moved exports, changed semantics) in the owning modules.
   Search for every occurrence of an old pattern before calling it migrated.
5. **Verify.** Run the playbook's verification ladder. Note honestly what could not be verified
   locally (another OS, live credentials) instead of implying it passed.
6. **Record.**
   - Rewrite the registry's *Last re-check* section for the new version, with the per-entry evidence
     from step 3. Replace it; it is not a log.
   - Update every spec that names the old version as current behavior. Historical rationale ("pi 0.86
     made…") stays as written.
   - Review `README.md` claims if a user-visible capability or platform changed.
7. **Ship.** Hand off to the `shipping-a-pr` skill with the PR body below. Commit subjects follow
   `git log` style, e.g. `chore(deps): upgrade pi to 1.5.2`. When a release forces a feature or fix,
   the PR may use `feat`/`fix` with the upgrade in the subject.

## PR body

Use the repo's PR template and fill its sections like this:

- **Problem**: the version range and what it brings that matters to ThinkRail (fixes users hit, new
  capabilities, breaking changes, any default that changes cost or behavior).
- **Approach**: the statement that every registry entry was re-checked against the installed code,
  then gates met (and what was removed), retained-with-evidence highlights, mirrors that followed
  upstream, adaptations added, and product decisions with the rejected alternatives.
- **Changes**: pins and lockfile delta, patches, per-module code changes, specs touched.
- **Release-notes material** (bold, inside Changes): user-visible changes the release notes must
  carry, such as default model moves, catalogue additions/removals, dropped or added platforms, and
  behavior changes, with what users should check.
- **Testing**: `check → result` bullets for every command run, then **Not verified** with the reason
  (an OS without a local runner, missing provider credentials) and the CI job or manual check that
  covers it.

## Adding a playbook

Add `playbooks/<dependency>.md` when the host starts working around a new dependency, or when an
upgrade of one has repeated enough to be worth writing down. Start it with the frontmatter above
(`dependency`, `packages`, `registry`, `current`, `latest`), then cover, in this order:

- **Where it is pinned**: every pin, patch and paired version, and which ones must stay unchanged.
- **Scope**: where its changelogs and source live, and what to diff.
- **Bump**: the exact commands and the lockfile delta to expect.
- **Mirrors and hazards**: host code that copies upstream behavior or private symbols and must follow
  it, plus problems past upgrades hit.
- **Verification ladder**: from the narrowest tests to the full gates, including platform-only checks.
- **Release-notes material**: what to collect for users.

Keep the shared procedure here and only the dependency's specifics in the playbook. Add the registry
to `AGENTS.md`'s upgrade bullet and link it from `architecture.md` Decision #10 when it is created.
