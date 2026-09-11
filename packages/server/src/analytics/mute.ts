export type AnalyticsEnv = Record<string, string | undefined>;

export type MuteReason = "ci" | "test";

export function environmentMute(env: AnalyticsEnv): MuteReason | null {
	if (env.CI) return "ci";
	if (env.NODE_ENV === "test") return "test";
	return null;
}
