// PostHog project API key for anonymous usage analytics — the same release seam as `version.ts`:
// committed with an EMPTY default so source/dev/e2e builds have no key (the host lands on the noop
// sink and never sends — see packages/server/src/analytics/SPEC.md), overwritten in the throwaway CI
// checkout by .github/actions/build-binary from the repo secret before `build:binary`.
// Not secret in the classic sense — a shipped binary necessarily carries it (public-by-design, like
// any client-side analytics key); dev-channel builds refuse a baked key regardless.
export const posthogApiKey = "";
