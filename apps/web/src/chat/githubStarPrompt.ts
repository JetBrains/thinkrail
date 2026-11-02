import { t } from "@thinkrail/locales/react";
import { firstPaintPreferenceStorage } from "../clientPreferences";
import { REPO_URL, STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";

const PROMPT_COUNT_KEY = `${STORAGE_PREFIX}github-star-prompt-count`;
const PROMPTS_BEFORE_ASK = 5;
const ASK_DURATION_MS = 15_000;

export function countSentPrompt(getStorage = firstPaintPreferenceStorage): boolean {
	try {
		const storage = getStorage();
		if (!storage) return false;
		const count = Number(storage.getItem(PROMPT_COUNT_KEY)) || 0;
		if (count >= PROMPTS_BEFORE_ASK) return false;
		const next = count + 1;
		storage.setItem(PROMPT_COUNT_KEY, String(next));
		return next === PROMPTS_BEFORE_ASK;
	} catch {
		return false;
	}
}

export function askForGithubStarOnFifthPrompt(): void {
	if (!countSentPrompt()) return;
	useAppStore.getState().pushToast({
		variant: "info",
		title: t("chat.githubStar.title"),
		message: t("chat.githubStar.message"),
		durationMs: ASK_DURATION_MS,
		action: {
			label: t("chat.githubStar.action"),
			onClick: () => window.open(REPO_URL, "_blank", "noopener,noreferrer"),
		},
	});
}
