# Changesets

Release intents for the published pi packages under `pi-extensions/*` (see `pi-extensions/SPEC.md`).
A PR that changes a published package adds one with `bun changeset`; private workspace packages are
never versioned. To release, a maintainer runs `bun run release:version` on a branch, commits the bumped
versions/changelogs and opens an ordinary PR; once it is on `main` with no changesets left, CI publishes.
