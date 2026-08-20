export type AnalyticsEnv = Record<string, string | undefined>;

export type MuteReason = "flag" | "env" | "ci" | "test";

export function environmentMute(env: AnalyticsEnv): MuteReason | null {
	if (env.THINKRAIL_NO_ANALYTICS) return "env";
	if (env.CI) return "ci";
	if (env.NODE_ENV === "test") return "test";
	return null;
}
