import type { OpenBranchReview } from "@thinkrail/contracts";
import { git, nonInteractiveGitEnv } from "../git";
import { runBounded } from "../subprocess";

const LOOKUP_TIMEOUT_MS = 8_000;
export const OPEN_BRANCH_REVIEW_CACHE_TTL_MS = 60_000;

type ReviewProvider = "github" | "gitlab";
type ProviderDetection = { provider: ReviewProvider | null; cacheable: boolean };
type CommandResult = { ok: boolean; out: string };
type CommandRunner = (cwd: string, command: string[]) => Promise<CommandResult>;
type LookupResult = { value: OpenBranchReview | null; cacheable: boolean };
type LookupOptions = { fresh?: boolean; now?: () => number };
type ParsedReviewNumber = { valid: true; value: number | null } | { valid: false };

function detectReviewProviderResult(cwd: string, branch: string): ProviderDetection {
	const configured = [
		git(cwd, ["config", "--get", `branch.${branch}.pushRemote`]).out,
		git(cwd, ["config", "--get", "remote.pushDefault"]).out,
		git(cwd, ["config", "--get", `branch.${branch}.remote`]).out,
	];
	const listed = git(cwd, ["remote"]);
	if (!listed.ok) return { provider: null, cacheable: false };
	const listedNames = new Set(listed.out.split("\n").filter(Boolean));
	const names = [...new Set([...configured, "origin", ...listedNames])];
	let failedListedRemote = false;

	for (const name of names) {
		if (!name || name === ".") continue;
		let resolved = false;
		for (const args of [
			["remote", "get-url", "--push", name],
			["remote", "get-url", name],
		]) {
			const remote = git(cwd, args);
			if (!remote.ok) continue;
			resolved = true;
			const provider = providerFromRemoteUrl(remote.out);
			if (provider) return { provider, cacheable: true };
		}
		if (listedNames.has(name) && !resolved) failedListedRemote = true;
	}
	return { provider: null, cacheable: !failedListedRemote };
}

export function detectReviewProvider(cwd: string, branch: string): ReviewProvider | null {
	return detectReviewProviderResult(cwd, branch).provider;
}

export function providerFromRemoteUrl(remoteUrl: string): ReviewProvider | null {
	const host = remoteHost(remoteUrl);
	if (host === "github.com") return "github";
	if (host === "gitlab.com") return "gitlab";
	return null;
}

function remoteHost(remoteUrl: string): string | null {
	try {
		const host = new URL(remoteUrl).hostname;
		if (host) return host.toLowerCase();
	} catch {}
	return /^(?:[^@/:\s]+@)?([^/:\s]+):/.exec(remoteUrl)?.[1]?.toLowerCase() ?? null;
}

const cached = new Map<string, { at: number; value: OpenBranchReview | null }>();
const inFlight = new Map<string, Promise<OpenBranchReview | null>>();

const cacheKey = (cwd: string, branch: string) => `${cwd}\u0000${branch}`;

export function findOpenBranchReview(
	cwd: string,
	branch: string,
	options: { fresh?: boolean } = {},
): Promise<OpenBranchReview | null> {
	return findOpenBranchReviewWithRunner(cwd, branch, runProviderCommand, options);
}

export function forgetOpenBranchReview(cwd: string): void {
	const prefix = `${cwd}\u0000`;
	for (const map of [cached, inFlight]) {
		for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
	}
}

function pruneCached(now: number): void {
	for (const [key, entry] of cached) {
		if (now - entry.at >= OPEN_BRANCH_REVIEW_CACHE_TTL_MS) cached.delete(key);
	}
}

export function findOpenBranchReviewWithRunner(
	cwd: string,
	branch: string,
	run: CommandRunner,
	options: LookupOptions = {},
): Promise<OpenBranchReview | null> {
	const now = options.now ?? Date.now;
	const key = cacheKey(cwd, branch);
	pruneCached(now());
	const running = inFlight.get(key);
	if (running) return running;
	if (!options.fresh) {
		const hit = cached.get(key);
		if (hit) return Promise.resolve(hit.value);
	} else {
		cached.delete(key);
	}
	const lookup: Promise<OpenBranchReview | null> = lookupOpenBranchReview(cwd, branch, run).then(
		(result) => {
			if (inFlight.get(key) !== lookup) {
				return findOpenBranchReviewWithRunner(cwd, branch, run, { now });
			}
			inFlight.delete(key);
			if (result.cacheable) cached.set(key, { at: now(), value: result.value });
			else cached.delete(key);
			return result.value;
		},
	);
	inFlight.set(key, lookup);
	return lookup;
}

async function lookupOpenBranchReview(
	cwd: string,
	branch: string,
	run: CommandRunner,
): Promise<LookupResult> {
	try {
		const detection = detectReviewProviderResult(cwd, branch);
		const provider = detection.provider;
		if (!provider) return { value: null, cacheable: detection.cacheable };

		const command =
			provider === "github"
				? [
						"gh",
						"pr",
						"list",
						"--head",
						branch,
						"--state",
						"open",
						"--json",
						"number",
						"--limit",
						"1",
					]
				: ["glab", "mr", "list", "--source-branch", branch, "--output", "json", "--per-page", "1"];
		const result = await run(cwd, command);
		if (!result.ok) return { value: null, cacheable: false };

		const parsed = parseReviewNumber(result.out, provider === "github" ? "number" : "iid");
		if (!parsed.valid) return { value: null, cacheable: false };
		return {
			value:
				parsed.value === null
					? null
					: {
							kind: provider === "github" ? "pull-request" : "merge-request",
							number: parsed.value,
						},
			cacheable: true,
		};
	} catch {
		return { value: null, cacheable: false };
	}
}

function parseReviewNumber(output: string, field: "number" | "iid"): ParsedReviewNumber {
	try {
		const rows: unknown = JSON.parse(output);
		if (!Array.isArray(rows)) return { valid: false };
		if (rows.length === 0) return { valid: true, value: null };
		const first: unknown = rows[0];
		if (typeof first !== "object" || first === null) return { valid: false };
		const value = (first as Record<string, unknown>)[field];
		return typeof value === "number" && Number.isSafeInteger(value) && value > 0
			? { valid: true, value }
			: { valid: false };
	} catch {
		return { valid: false };
	}
}

export function reviewNumber(output: string, field: "number" | "iid"): number | null {
	const parsed = parseReviewNumber(output, field);
	return parsed.valid ? parsed.value : null;
}

export async function runProviderCommand(
	cwd: string,
	command: string[],
	timeoutMs: number = LOOKUP_TIMEOUT_MS,
): Promise<CommandResult> {
	const run = await runBounded(command, {
		cwd,
		timeoutMs,
		env: {
			...nonInteractiveGitEnv(),
			GH_PROMPT_DISABLED: "1",
			GLAB_PROMPT_DISABLED: "1",
			NO_COLOR: "1",
		},
	});
	return { ok: run.ok, out: run.out.trim() };
}
