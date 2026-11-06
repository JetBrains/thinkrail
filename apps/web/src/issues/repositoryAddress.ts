import { canonicalIssueInstanceUrl, issueProviderForInstanceUrl } from "@thinkrail/contracts";

export type IssueRepositoryAddressResult =
	| { status: "valid"; instanceUrl: string; projectId: string }
	| { status: "invalid" }
	| { status: "needs-instance" };

function parseAddress(value: string): { url: URL; canonical: string; segments: string[] } | null {
	const canonical = canonicalIssueInstanceUrl(value);
	if (canonical === null) return null;
	const path = /^https?:\/\/[^/]+(\/.*)?$/i.exec(value)?.[1] ?? "";
	const rawSegments = path.replace(/\/+$/, "").slice(1).split("/");
	const segments: string[] = [];
	try {
		for (const raw of path.replace(/\/+$/, "") ? rawSegments : []) {
			const segment = decodeURIComponent(raw);
			if (
				!segment ||
				segment === "." ||
				segment === ".." ||
				/[\s/\\%?#@]/.test(segment) ||
				[...segment].some((character) => {
					const code = character.charCodeAt(0);
					return code < 32 || (code >= 127 && code <= 159);
				})
			)
				return null;
			segments.push(segment);
		}
		return { url: new URL(canonical), canonical, segments };
	} catch {
		return null;
	}
}

function projectPath(segments: readonly string[]): string | null {
	const projectId = segments.join("/").replace(/\.git$/, "");
	return segments.length >= 2 &&
		projectId.split("/").every((segment) => segment && segment !== "." && segment !== "..")
		? projectId
		: null;
}

export function suggestIssueRepositoryAddress(
	repositoryUrl: string,
): { instanceUrl: string; projectId: string } | null {
	const repository = parseAddress(repositoryUrl);
	if (!repository) return null;
	const projectId = projectPath(repository.segments);
	return projectId === null ? null : { instanceUrl: repository.url.origin, projectId };
}

export function resolveIssueRepositoryAddress(
	repositoryUrl: string,
	explicitInstanceUrl?: string,
): IssueRepositoryAddressResult {
	const repository = parseAddress(repositoryUrl);
	if (!repository) return { status: "invalid" };
	let instanceUrl = repository.url.origin;
	let projectSegments = repository.segments;
	if (explicitInstanceUrl !== undefined) {
		const instance = parseAddress(explicitInstanceUrl);
		if (
			!instance ||
			instance.url.origin !== repository.url.origin ||
			!instance.segments.every((segment, index) => segment === repository.segments[index])
		)
			return { status: "invalid" };
		instanceUrl = instance.canonical;
		projectSegments = repository.segments.slice(instance.segments.length);
	}
	const projectId = projectPath(projectSegments);
	if (projectId === null) return { status: "invalid" };
	// github.com is self-describing; every other host still needs its GitLab instance prefix.
	if (
		explicitInstanceUrl === undefined &&
		issueProviderForInstanceUrl(repository.url.origin) !== "github" &&
		repository.url.origin !== "https://gitlab.com"
	) {
		return { status: "needs-instance" };
	}
	return { status: "valid", instanceUrl, projectId };
}
