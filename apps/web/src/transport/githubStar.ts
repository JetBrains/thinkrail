import type { GithubStarAsk } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { REPO_URL } from "../constants/branding";
import type { Toast } from "../store";

const GITHUB_STAR_ASK_MS = 60_000;

export function formatStarCount(count: number): string {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function starsOf(data: unknown): number | null {
	const stars = typeof data === "object" && data !== null ? Reflect.get(data, "stars") : null;
	return Number.isSafeInteger(stars) && (stars as number) >= 0 ? (stars as number) : null;
}

export function githubStarToast(data: unknown): Omit<Toast, "id"> {
	const stars: GithubStarAsk["stars"] = starsOf(data);
	return {
		variant: "info",
		title: t("app.githubStar.title"),
		message: t("app.githubStar.message"),
		durationMs: GITHUB_STAR_ASK_MS,
		action: {
			label:
				stars === null
					? t("app.githubStar.action")
					: t("app.githubStar.actionStars", { stars: formatStarCount(stars) }),
			onClick: () => window.open(REPO_URL, "_blank", "noopener,noreferrer"),
		},
	};
}
