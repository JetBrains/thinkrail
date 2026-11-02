import { t } from "@thinkrail/locales/react";
import { firstPaintPreferenceStorage } from "../clientPreferences";
import { REPO_URL, STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";

const PROMPT_COUNT_KEY = `${STORAGE_PREFIX}github-star-prompt-count`;
const PROMPTS_BEFORE_ASK = 10;
const REPO_API_URL = "https://api.github.com/repos/JetBrains/thinkrail";
const STAR_COUNT_TIMEOUT_MS = 2_000;
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

export function formatStarCount(count: number): string {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

async function fetchStarCount(): Promise<number | null> {
	try {
		const response = await fetch(REPO_API_URL, {
			signal: AbortSignal.timeout(STAR_COUNT_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const data: { stargazers_count?: unknown } = await response.json();
		return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
	} catch {
		return null;
	}
}

export function askForGithubStarOnTenthPrompt(): void {
	if (!countSentPrompt()) return;
	void fetchStarCount().then((stars) => {
		useAppStore.getState().pushToast({
			variant: "info",
			title: t("chat.githubStar.title"),
			message: t("chat.githubStar.message"),
			durationMs: ASK_DURATION_MS,
			action: {
				label:
					stars === null
						? t("chat.githubStar.action")
						: t("chat.githubStar.actionStars", { stars: formatStarCount(stars) }),
				onClick: () => window.open(REPO_URL, "_blank", "noopener,noreferrer"),
			},
		});
	});
}
