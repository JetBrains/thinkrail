const REPO_API_URL = "https://api.github.com/repos/JetBrains/thinkrail";
const STARS_TIMEOUT_MS = 2_000;

let fetchOverride: typeof fetch | null = null;

export function setGithubStarsFetchForTests(next: typeof fetch | null): void {
	fetchOverride = next;
}

export async function fetchGithubStars(): Promise<number | null> {
	try {
		const response = await (fetchOverride ?? fetch)(REPO_API_URL, {
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(STARS_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const body: unknown = await response.json();
		const stars =
			typeof body === "object" && body !== null ? Reflect.get(body, "stargazers_count") : null;
		return Number.isSafeInteger(stars) && (stars as number) >= 0 ? (stars as number) : null;
	} catch {
		return null;
	}
}
