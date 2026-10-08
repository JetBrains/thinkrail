import type { BranchReviewState, OpenBranchReview } from "@thinkrail/contracts";
import { gitAsync, nonInteractiveGitEnv } from "../git";
import { runBounded } from "../subprocess";

const LOOKUP_TIMEOUT_MS = 8_000;
export const OPEN_BRANCH_REVIEW_CACHE_TTL_MS = 60_000;

type ReviewProvider = "github" | "gitlab";
type ProviderDetection = { provider: ReviewProvider | null; cacheable: boolean };
type CommandResult = { ok: boolean; out: string };
type CommandRunner = (cwd: string, command: string[]) => Promise<CommandResult>;
type LookupResult = { value: OpenBranchReview | null; cacheable: boolean };
type LookupOptions = { fresh?: boolean; now?: () => number };
type ReviewRow = {
	number: number;
	url?: string;
	state?: BranchReviewState;
	changedAt?: number;
	createdAt?: number;
};
type ParsedReviewRows = { valid: true; rows: ReviewRow[] } | { valid: false };
const SETTLED_REVIEW_ROW_LIMIT = "5";

function inspect(cwd: string, args: string[]) {
	return gitAsync(cwd, args, { timeoutMs: LOOKUP_TIMEOUT_MS });
}

async function detectReviewProviderResult(cwd: string, branch: string): Promise<ProviderDetection> {
	const [pushRemote, pushDefault, branchRemote, listed] = await Promise.all([
		inspect(cwd, ["config", "--get", `branch.${branch}.pushRemote`]),
		inspect(cwd, ["config", "--get", "remote.pushDefault"]),
		inspect(cwd, ["config", "--get", `branch.${branch}.remote`]),
		inspect(cwd, ["remote"]),
	]);
	if (!listed.ok) return { provider: null, cacheable: false };
	const configured = [pushRemote.out, pushDefault.out, branchRemote.out];
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
			const remote = await inspect(cwd, args);
			if (!remote.ok) continue;
			resolved = true;
			const provider = providerFromRemoteUrl(remote.out);
			if (provider) return { provider, cacheable: true };
		}
		if (listedNames.has(name) && !resolved) failedListedRemote = true;
	}
	return { provider: null, cacheable: !failedListedRemote };
}

export async function detectReviewProvider(
	cwd: string,
	branch: string,
): Promise<ReviewProvider | null> {
	return (await detectReviewProviderResult(cwd, branch)).provider;
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

/** `reliable` = the provider answered (a `null` then truly means "no review"); unreliable nulls are failures. */
export type BranchReviewOutcome = { value: OpenBranchReview | null; reliable: boolean };

const cached = new Map<string, { at: number; value: OpenBranchReview | null }>();
const inFlight = new Map<string, Promise<BranchReviewOutcome>>();

const cacheKey = (cwd: string, branch: string) => `${cwd}\u0000${branch}`;

export function findBranchReviewOutcome(
	cwd: string,
	branch: string,
	options: { fresh?: boolean } = {},
): Promise<BranchReviewOutcome> {
	return findBranchReviewOutcomeWithRunner(cwd, branch, runProviderCommand, options);
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
	return findBranchReviewOutcomeWithRunner(cwd, branch, run, options).then(
		(outcome) => outcome.value,
	);
}

export function findBranchReviewOutcomeWithRunner(
	cwd: string,
	branch: string,
	run: CommandRunner,
	options: LookupOptions = {},
): Promise<BranchReviewOutcome> {
	const now = options.now ?? Date.now;
	const key = cacheKey(cwd, branch);
	pruneCached(now());
	const running = inFlight.get(key);
	if (running) return running;
	if (!options.fresh) {
		const hit = cached.get(key);
		if (hit) return Promise.resolve({ value: hit.value, reliable: true });
	} else {
		cached.delete(key);
	}
	const lookup: Promise<BranchReviewOutcome> = lookupOpenBranchReview(cwd, branch, run).then(
		(result) => {
			if (inFlight.get(key) !== lookup) {
				return findBranchReviewOutcomeWithRunner(cwd, branch, run, { now });
			}
			inFlight.delete(key);
			if (result.cacheable) cached.set(key, { at: now(), value: result.value });
			else cached.delete(key);
			return { value: result.value, reliable: result.cacheable };
		},
	);
	inFlight.set(key, lookup);
	return lookup;
}

function reviewListCommand(
	provider: ReviewProvider,
	branch: string,
	scope: "open" | "settled",
): string[] {
	if (provider === "github") {
		return [
			"gh",
			"pr",
			"list",
			"--head",
			branch,
			"--state",
			scope === "open" ? "open" : "all",
			"--json",
			"number,url,state,mergedAt,closedAt,createdAt",
			"--limit",
			scope === "open" ? "1" : SETTLED_REVIEW_ROW_LIMIT,
		];
	}
	return [
		"glab",
		"mr",
		"list",
		"--source-branch",
		branch,
		...(scope === "open" ? [] : ["--all"]),
		"--output",
		"json",
		"--per-page",
		scope === "open" ? "1" : SETTLED_REVIEW_ROW_LIMIT,
	];
}

async function listReviewRows(
	cwd: string,
	provider: ReviewProvider,
	branch: string,
	scope: "open" | "settled",
	run: CommandRunner,
): Promise<ReviewRow[] | null> {
	const result = await run(cwd, reviewListCommand(provider, branch, scope));
	if (!result.ok) return null;
	const parsed = parseReviewRows(result.out, provider === "github" ? "number" : "iid");
	return parsed.valid ? parsed.rows : null;
}

/**
 * Open reviews are asked for on their own and win outright; only when there is none does the lookup
 * page through the newest merged/closed rows — a bounded combined page could bury an older open review
 * under newer settled ones.
 */
async function lookupOpenBranchReview(
	cwd: string,
	branch: string,
	run: CommandRunner,
): Promise<LookupResult> {
	try {
		const detection = await detectReviewProviderResult(cwd, branch);
		const provider = detection.provider;
		if (!provider) return { value: null, cacheable: detection.cacheable };

		const open = await listReviewRows(cwd, provider, branch, "open", run);
		if (open === null) return { value: null, cacheable: false };
		let row = pickReviewRow(open);
		if (row === null) {
			const settled = await listReviewRows(cwd, provider, branch, "settled", run);
			if (settled === null) return { value: null, cacheable: false };
			row = pickReviewRow(settled);
		}
		return {
			value:
				row === null
					? null
					: {
							kind: provider === "github" ? "pull-request" : "merge-request",
							number: row.number,
							...(row.url ? { url: row.url } : {}),
							...(row.state ? { state: row.state } : {}),
							...(row.changedAt !== undefined ? { changedAt: row.changedAt } : {}),
						},
			cacheable: true,
		};
	} catch {
		return { value: null, cacheable: false };
	}
}

function reviewRowUrl(row: Record<string, unknown>): string | undefined {
	for (const key of ["url", "web_url", "webUrl"]) {
		const value = row[key];
		if (typeof value === "string" && /^https:\/\/\S+$/.test(value)) return value;
	}
	return undefined;
}

function reviewRowState(row: Record<string, unknown>): BranchReviewState | undefined {
	const raw = row.state;
	if (typeof raw !== "string") return undefined;
	switch (raw.toLowerCase()) {
		case "open":
		case "opened":
		case "locked":
			return "open";
		case "merged":
			return "merged";
		case "closed":
			return "closed";
		default:
			return undefined;
	}
}

function reviewRowTime(row: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = row[key];
		if (typeof value !== "string") continue;
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function parseReviewRows(output: string, field: "number" | "iid"): ParsedReviewRows {
	try {
		const rows: unknown = JSON.parse(output);
		if (!Array.isArray(rows)) return { valid: false };
		const parsed: ReviewRow[] = [];
		for (const item of rows) {
			if (typeof item !== "object" || item === null) return { valid: false };
			const row = item as Record<string, unknown>;
			const value = row[field];
			if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
				return { valid: false };
			const url = reviewRowUrl(row);
			const state = reviewRowState(row);
			const changedAt =
				state === "merged"
					? reviewRowTime(row, ["mergedAt", "merged_at"])
					: state === "closed"
						? reviewRowTime(row, ["closedAt", "closed_at"])
						: undefined;
			if ((state === "merged" || state === "closed") && changedAt === undefined) {
				return { valid: false };
			}
			const createdAt = reviewRowTime(row, ["createdAt", "created_at"]);
			parsed.push({
				number: value,
				...(url ? { url } : {}),
				...(state ? { state } : {}),
				...(changedAt !== undefined ? { changedAt } : {}),
				...(createdAt !== undefined ? { createdAt } : {}),
			});
		}
		return { valid: true, rows: parsed };
	} catch {
		return { valid: false };
	}
}

/** An open review wins; otherwise the most recently merged/closed one (newest-created on a tie). */
export function pickReviewRow(rows: readonly ReviewRow[]): ReviewRow | null {
	if (rows.length === 0) return null;
	const open = rows.find((row) => row.state === "open" || row.state === undefined);
	if (open) return open;
	return rows.reduce((best, row) => {
		const bestAt = best.changedAt ?? best.createdAt ?? 0;
		const rowAt = row.changedAt ?? row.createdAt ?? 0;
		return rowAt > bestAt ? row : best;
	});
}

export function reviewNumber(output: string, field: "number" | "iid"): number | null {
	const parsed = parseReviewRows(output, field);
	return parsed.valid ? (parsed.rows[0]?.number ?? null) : null;
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
