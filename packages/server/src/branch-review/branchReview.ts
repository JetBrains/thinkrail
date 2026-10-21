import type {
	BranchReviewState,
	MergeMethod,
	OpenBranchReview,
	ReviewChecks,
	ReviewDecision,
	ReviewDetails,
	ReviewMergeState,
	ReviewProvider,
} from "@thinkrail/contracts";
import { gitAsync, nonInteractiveGitEnv } from "../git";
import { runBounded } from "../subprocess";

const LOOKUP_TIMEOUT_MS = 8_000;
export const OPEN_BRANCH_REVIEW_CACHE_TTL_MS = 60_000;
const REPO_MERGE_SETTINGS_TTL_MS = 10 * 60_000;

type ProviderDetection = {
	provider: ReviewProvider | null;
	cacheable: boolean;
	remoteUrl?: string;
};
type CommandResult = { ok: boolean; out: string; err?: string };
type CommandRunner = (cwd: string, command: string[]) => Promise<CommandResult>;
type LookupResult = { value: OpenBranchReview | null; cacheable: boolean };
type LookupOptions = { fresh?: boolean; now?: () => number };
type ReviewRow = {
	number: number;
	url?: string;
	state?: BranchReviewState;
	changedAt?: number;
	createdAt?: number;
	details?: ReviewDetails;
	head?: string;
};
type RepoMergeSettings = Pick<ReviewDetails, "mergeMethods" | "deleteBranchOnMerge">;
type ParsedReviewRows = { valid: true; rows: ReviewRow[] } | { valid: false };
const SETTLED_REVIEW_ROW_LIMIT = "5";
const GITHUB_ROW_FIELDS = "number,url,state,mergedAt,closedAt,createdAt";
const GITHUB_DETAIL_FIELDS =
	"isDraft,baseRefName,reviewDecision,mergeStateStatus,statusCheckRollup,latestReviews,headRepositoryOwner,headRepository";
const FAILING_NAMES_LIMIT = 10;
const REVIEWERS_LIMIT = 5;

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
			if (provider) return { provider, cacheable: true, remoteUrl: remote.out };
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

export function githubSlug(remoteUrl: string): string | null {
	const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
	return match ? `${match[1]}/${match[2]}` : null;
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
			scope === "open"
				? `${GITHUB_ROW_FIELDS},${GITHUB_DETAIL_FIELDS}`
				: `${GITHUB_ROW_FIELDS},headRepositoryOwner,headRepository`,
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
	ownSlug: string | null = null,
): Promise<ReviewRow[] | null> {
	const result = await run(cwd, reviewListCommand(provider, branch, scope));
	if (!result.ok) return null;
	const parsed = parseReviewRows(result.out, provider === "github" ? "number" : "iid", ownSlug);
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

		const ownSlug =
			provider === "github" && detection.remoteUrl ? githubSlug(detection.remoteUrl) : null;
		const open = await listReviewRows(cwd, provider, branch, "open", run, ownSlug);
		if (open === null) return { value: null, cacheable: false };
		let row = pickReviewRow(open);
		if (row === null) {
			const settled = await listReviewRows(cwd, provider, branch, "settled", run);
			if (settled === null) return { value: null, cacheable: false };
			row = pickReviewRow(
				ownSlug ? settled.filter((r) => !r.head || r.head === ownSlug.toLowerCase()) : settled,
			);
		}
		const settings =
			row?.details && detection.remoteUrl
				? await repoMergeSettings(cwd, detection.remoteUrl, run)
				: null;
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
							...(row.details ? { details: { ...row.details, ...settings } } : {}),
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

const REVIEW_DECISIONS: Record<string, ReviewDecision> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes_requested",
	REVIEW_REQUIRED: "review_required",
};

const MERGE_STATES = new Set<ReviewMergeState>([
	"clean",
	"unstable",
	"has_hooks",
	"blocked",
	"behind",
	"dirty",
	"draft",
	"unknown",
]);

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAILING_CONCLUSIONS = new Set([
	"FAILURE",
	"TIMED_OUT",
	"CANCELLED",
	"ACTION_REQUIRED",
	"STARTUP_FAILURE",
]);

type CheckVerdict = "passing" | "pending" | "failing";

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function checkVerdict(check: Record<string, unknown>): CheckVerdict | null {
	if (check.__typename === "StatusContext") {
		const state = text(check.state).toUpperCase();
		if (state === "SUCCESS") return "passing";
		if (state === "FAILURE" || state === "ERROR") return "failing";
		return "pending";
	}
	if (text(check.status).toUpperCase() !== "COMPLETED") return "pending";
	const conclusion = text(check.conclusion).toUpperCase();
	if (PASSING_CONCLUSIONS.has(conclusion)) return "passing";
	if (FAILING_CONCLUSIONS.has(conclusion)) return "failing";
	return null;
}

function checkName(check: Record<string, unknown>): string {
	return text(check.name) || text(check.context);
}

function checkStartedAt(check: Record<string, unknown>): string {
	return text(check.startedAt) || text(check.completedAt) || text(check.createdAt);
}

function latestChecks(rollup: unknown[]): Record<string, unknown>[] {
	const byName = new Map<string, Record<string, unknown>>();
	for (const item of rollup) {
		if (typeof item !== "object" || item === null) continue;
		const check = item as Record<string, unknown>;
		const name = checkName(check);
		if (!name) continue;
		const key = `${text(check.workflowName)}\u0000${name}`;
		const seen = byName.get(key);
		if (!seen || checkStartedAt(check) >= checkStartedAt(seen)) byName.set(key, check);
	}
	return [...byName.values()];
}

function reviewChecks(rollup: unknown): ReviewChecks | undefined {
	if (!Array.isArray(rollup)) return undefined;
	const checks: ReviewChecks = { passing: 0, pending: 0, failing: 0, failingNames: [] };
	for (const check of latestChecks(rollup)) {
		const verdict = checkVerdict(check);
		if (!verdict) continue;
		checks[verdict] += 1;
		if (verdict === "failing" && checks.failingNames.length < FAILING_NAMES_LIMIT) {
			checks.failingNames.push(checkName(check));
		}
	}
	return checks.passing + checks.pending + checks.failing > 0 ? checks : undefined;
}

function reviewers(latest: unknown): ReviewDetails["reviewers"] {
	if (!Array.isArray(latest)) return [];
	const found: ReviewDetails["reviewers"] = [];
	for (const item of latest) {
		if (found.length >= REVIEWERS_LIMIT) break;
		if (typeof item !== "object" || item === null) continue;
		const review = item as Record<string, unknown>;
		const author = review.author as Record<string, unknown> | null | undefined;
		const login = text(author?.login);
		const state = text(review.state).toUpperCase();
		if (!login) continue;
		if (state === "APPROVED") found.push({ login, state: "approved" });
		else if (state === "CHANGES_REQUESTED") found.push({ login, state: "changes_requested" });
	}
	return found;
}

function headRepositorySlug(row: Record<string, unknown>): string | null {
	const owner = row.headRepositoryOwner as Record<string, unknown> | null | undefined;
	const repo = row.headRepository as Record<string, unknown> | null | undefined;
	const login = text(owner?.login);
	const name = text(repo?.name);
	return login && name ? `${login}/${name}`.toLowerCase() : null;
}

function reviewRowDetails(
	row: Record<string, unknown>,
	ownSlug: string | null,
): ReviewDetails | undefined {
	if (typeof row.isDraft !== "boolean") return undefined;
	if (!ownSlug || headRepositorySlug(row) !== ownSlug.toLowerCase()) return undefined;
	const mergeState = text(row.mergeStateStatus).toLowerCase() as ReviewMergeState;
	const checks = reviewChecks(row.statusCheckRollup);
	const decision = REVIEW_DECISIONS[text(row.reviewDecision).toUpperCase()];
	const base = text(row.baseRefName);
	return {
		draft: row.isDraft,
		...(base ? { base } : {}),
		...(checks ? { checks } : {}),
		...(decision ? { reviewDecision: decision } : {}),
		reviewers: reviewers(row.latestReviews),
		mergeState: MERGE_STATES.has(mergeState) ? mergeState : "unknown",
	};
}

const repoSettingsCache = new Map<string, { at: number; value: RepoMergeSettings }>();

async function repoMergeSettings(
	cwd: string,
	remoteUrl: string,
	run: CommandRunner,
): Promise<RepoMergeSettings | null> {
	const hit = repoSettingsCache.get(remoteUrl);
	if (hit && Date.now() - hit.at < REPO_MERGE_SETTINGS_TTL_MS) return hit.value;
	const result = await run(cwd, [
		"gh",
		"repo",
		"view",
		"--json",
		"mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge",
	]).catch(() => null);
	if (!result?.ok) return null;
	try {
		const repo: unknown = JSON.parse(result.out);
		if (typeof repo !== "object" || repo === null) return null;
		const fields = repo as Record<string, unknown>;
		const allowed: [MergeMethod, unknown][] = [
			["squash", fields.squashMergeAllowed],
			["merge", fields.mergeCommitAllowed],
			["rebase", fields.rebaseMergeAllowed],
		];
		const value: RepoMergeSettings = {
			mergeMethods: allowed.filter(([, on]) => on === true).map(([method]) => method),
			...(typeof fields.deleteBranchOnMerge === "boolean"
				? { deleteBranchOnMerge: fields.deleteBranchOnMerge }
				: {}),
		};
		repoSettingsCache.set(remoteUrl, { at: Date.now(), value });
		return value;
	} catch {
		return null;
	}
}

function parseReviewRows(
	output: string,
	field: "number" | "iid",
	ownSlug: string | null = null,
): ParsedReviewRows {
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
			const details = state === "open" ? reviewRowDetails(row, ownSlug) : undefined;
			const head = headRepositorySlug(row);
			parsed.push({
				...(head ? { head } : {}),
				number: value,
				...(url ? { url } : {}),
				...(state ? { state } : {}),
				...(changedAt !== undefined ? { changedAt } : {}),
				...(createdAt !== undefined ? { createdAt } : {}),
				...(details ? { details } : {}),
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
	return { ok: run.ok, out: run.out.trim(), err: run.err.trim() };
}
