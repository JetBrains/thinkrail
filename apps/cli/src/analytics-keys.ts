// GA4 (Firebase Analytics) credentials for anonymous usage analytics — the same release seam as
// `version.ts`: committed with EMPTY defaults so source/dev/e2e builds have no keys (the host lands on
// the noop sink and never sends — see packages/server/src/analytics/SPEC.md), overwritten in the
// throwaway CI checkout by .github/actions/build-binary from repo secrets before `build:binary`.
// Not secret in the classic sense — a shipped binary necessarily carries them (accepted, same exposure
// class as any app's Firebase config); dev-channel builds refuse baked keys regardless.
export const ga4MeasurementId = "";
export const ga4ApiSecret = "";
