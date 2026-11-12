const repositoryApiUrl = "https://api.github.com/repos/JetBrains/thinkrail";

export function formatStarCount(stars: number): string {
	return stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : String(stars);
}

export async function fetchStarCount(): Promise<string | undefined> {
	try {
		const response = await fetch(repositoryApiUrl);
		if (!response.ok) return undefined;
		const data: { stargazers_count?: unknown } | null = await response.json();
		return typeof data?.stargazers_count === "number"
			? formatStarCount(data.stargazers_count)
			: undefined;
	} catch {
		return undefined;
	}
}
