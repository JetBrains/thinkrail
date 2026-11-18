import type { Translator } from "@thinkrail/locales/react";
import type { MissCause } from "@thinkrail/pi-session-insights/core";
import { formatDuration } from "../format";
import { CAUSE_LABEL } from "./look";

/** A cache-miss cause in words; a pause names its length. */
export function causeText(t: Translator, cause: MissCause, gapMs: number | null): string {
	if (cause === "pause" && gapMs !== null)
		return t("sessionInsights.context.cause.pauseFor", { duration: formatDuration(t, gapMs) });
	return t(CAUSE_LABEL[cause]);
}
