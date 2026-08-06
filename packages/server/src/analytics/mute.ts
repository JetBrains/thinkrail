// The environment mute policy: the ONE place that decides whether *this process* may send analytics at
// all, whichever entrypoint booted the host. Centralizing it here (rather than in each launcher) is what
// makes "no entrypoint can forget to mute" true — `dev.ts` parses no argv, and unit tests boot hosts with
// no options at all. Every reason fails closed: an unexpected value mutes, it never enables.

/**
 * The env slice the policy reads. Injected rather than read off `process.env` at the point of use so the
 * module's own tests can exercise the *sending* path — `bun test` sets `NODE_ENV=test`, which would
 * otherwise mute the whole suite.
 */
export type AnalyticsEnv = Record<string, string | undefined>;

/** Why a run is muted. `flag` is the launcher's `--no-analytics`; the other three are environmental. */
export type MuteReason = "flag" | "env" | "ci" | "test";

/**
 * The environmental mute reasons in precedence order, or `null` when this process may send.
 * - `env`  — `THINKRAIL_NO_ANALYTICS` (any non-empty value): the documented per-run opt-out.
 * - `ci`   — `CI` (any non-empty value): GitHub Actions and every other CI. Automated runs never send.
 * - `test` — `NODE_ENV=test`, which `bun test` sets: a unit test that boots a host stays silent.
 */
export function environmentMute(env: AnalyticsEnv): MuteReason | null {
	if (env.THINKRAIL_NO_ANALYTICS) return "env";
	if (env.CI) return "ci";
	if (env.NODE_ENV === "test") return "test";
	return null;
}
