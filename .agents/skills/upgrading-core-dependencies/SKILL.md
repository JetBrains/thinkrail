---
name: upgrading-core-dependencies
description: "Use when upgrading pi (the @earendil-works/pi-* packages) or Electrobun/Hutch in the ThinkRail repo, or when re-checking their compatibility registries for workarounds that a newer release lets us delete. Not for routine dependency bumps of other packages."
---

# Upgrading pi or Electrobun

pi and Electrobun are the two dependencies the host most often works around. Each has a compatibility
registry listing those workarounds and their removal gates. An upgrade does more than bump a version:
it re-checks every registry entry against the newly installed code, deletes what upstream now covers,
adapts to what moved, and ships one PR that records the evidence.

| Upgrading | Registry (what to re-check) | Playbook (how) |
| --- | --- | --- |
| `@earendil-works/pi-*` | `pi-compatibility.md` | [pi.md](pi.md) |
| `electrobun` (and its paired Hutch) | `electrobun-compatibility.md` | [electrobun.md](electrobun.md) |

Read the registry in full, then the playbook. The registry is the source of truth for the entries and
their gates; neither this skill nor the playbooks restate them. Upgrade one dependency per PR.

## Ground rules

- **Installed code is the evidence.** Check each gate against the installed package's exports and
  implementation, or the upstream source at the release tag, not against release notes or an issue's
  open/closed state. Changelogs tell you where to look; they do not close a gate.
- **A parity or regression failure means drift.** It is not permission to weaken, skip, or re-baseline
  the test. Find what pi or Electrobun changed, then follow it, port the workaround, or stop and ask.
- **Upstream defaults that change product behavior are the user's decision.** A new default that
  spends tokens or money, changes what users see, or moves their defaults (pi 1.5.1's idle cache
  warming is the canonical case) goes to the user through `ask_user_question` with a recommendation
  before you adopt or neutralize it.
- **Walk intermediate releases.** When the range spans several releases (1.5.0 → 1.5.1 → 1.5.2), read
  every changelog in between. Re-checks may be done once against the target, but name the release
  that changed each thing.
- **Spec first for boundary changes.** A new or removed workaround updates its owning module spec and
  the registry in the same PR (the registry's *Upgrade contract* says how).
- **No suppressions to get green.** The repo-wide hygiene rules in `AGENTS.md` apply in full.

## Procedure

Track it as a TODO plan; these phases make a good skeleton.

1. **Scope.** Record the current pin and pick the target, by default the latest stable release. Read
   the changelog for every release in the range and list what touches the host: changed or removed
   exports the host imports, behavior behind a registry entry, new defaults, catalogue/platform
   changes, fixes users will notice. Raise the product decisions now, not after the bump.
2. **Bump.** Change the pin(s) and reinstall with the pinned Bun (playbook has the exact commands).
   The lockfile delta should contain only the upgraded packages and their own dependency changes; read
   it before going further.
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
