import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { GhSetupProblem, OpenPrResult, PrBodySource, PrPreview } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	forgetOpenBranchReview,
	providerFromRemoteUrl,
	reviewNumber,
	runProviderCommand,
} from "../branch-review";
import {
	assertSafeRef,
	git,
	gitAsync,
	gitStatus,
	isSafeRef,
	listRemotes,
	originUrls,
	remoteNameOf,
	remoteRefOid,
} from "../git";
import { ghSetupProblem } from "../github";
import { generateTodoSummary, listTodos } from "../todos";
import { getWorkspace, refreshUserOwnedWorkspace } from "../workspaces";
import { flatItems, renderPrBody } from "./prBody";

const COMPARE_BODY_LIMIT = 4_000;

export type PrCommandRunner = (
	cwd: string,
	command: string[],
	timeoutMs?: number,
) => Promise<{ ok: boolean; out: string; err?: string }>;

export const MUTATION_TIMEOUT_MS = 60_000;

export interface OpenPrParams {
	workspaceId: string;
	sessionId?: string;
	branch?: string;
	title?: string;
	titleEdited?: boolean;
	body?: string;
	draft?: boolean;
}

/** Server-only context used by the host to fence persistence; stripped before the wire response. */
export type OpenPrHostResult = OpenPrResult & { branch: string };

export interface PreviewPrParams {
	workspaceId: string;
	sessionId?: string;
	title?: string;
	source?: PrBodySource;
	template?: string;
}

const TEMPLATE_MAX_BYTES = 64 * 1024;
const COMMIT_SUBJECTS_MAX = 50;
const DIFF_STAT_MAX_LINES = 60;
const GITHUB_TEMPLATE = /^pull_request_template\.md$/i;
const GITHUB_TEMPLATE_DIR = /^pull_request_template$/i;

async function containedFile(worktreePath: string, path: string): Promise<boolean> {
	const [stat, root, real] = await Promise.all([
		lstat(path).catch(() => null),
		realpath(worktreePath).catch(() => null),
		realpath(path).catch(() => null),
	]);
	if (!stat?.isFile() || stat.size > TEMPLATE_MAX_BYTES || root === null || real === null) {
		return false;
	}
	return real.startsWith(`${root}${sep}`);
}

async function entries(dir: string): Promise<string[]> {
	return (await readdir(dir).catch(() => [] as string[])).sort();
}

export async function discoverTemplates(worktreePath: string): Promise<string[]> {
	const found: string[] = [];
	for (const dir of [".github", "", "docs"]) {
		for (const name of await entries(join(worktreePath, dir))) {
			const rel = dir ? `${dir}/${name}` : name;
			if (
				GITHUB_TEMPLATE.test(name) &&
				(await containedFile(worktreePath, join(worktreePath, rel)))
			)
				found.push(rel);
		}
	}
	for (const name of await entries(join(worktreePath, ".github"))) {
		if (!GITHUB_TEMPLATE_DIR.test(name)) continue;
		for (const file of await entries(join(worktreePath, ".github", name))) {
			const rel = `.github/${name}/${file}`;
			if (
				file.toLowerCase().endsWith(".md") &&
				(await containedFile(worktreePath, join(worktreePath, rel)))
			) {
				found.push(rel);
			}
		}
	}
	for (const file of await entries(join(worktreePath, ".gitlab", "merge_request_templates"))) {
		const rel = `.gitlab/merge_request_templates/${file}`;
		if (
			file.toLowerCase().endsWith(".md") &&
			(await containedFile(worktreePath, join(worktreePath, rel)))
		) {
			found.push(rel);
		}
	}
	return found;
}

async function readTemplate(
	worktreePath: string,
	templates: string[],
	template: string | undefined,
): Promise<string | null> {
	const chosen = template === undefined ? templates[0] : templates.find((t) => t === template);
	if (!chosen) return null;
	return (await readFile(join(worktreePath, chosen), "utf8").catch(() => null))?.trim() ?? null;
}

async function commitSubjects(worktreePath: string, baseBranch: string): Promise<string[]> {
	if (!isSafeRef(baseBranch)) return [];
	const log = await gitAsync(worktreePath, [
		"log",
		"--reverse",
		`--max-count=${COMMIT_SUBJECTS_MAX}`,
		"--format=%s",
		"--end-of-options",
		`${baseBranch}..HEAD`,
		"--",
	]);
	return log.ok && log.out ? log.out.split("\n").filter((line) => line.trim() !== "") : [];
}

async function sessionPlan(
	workspaceId: string,
	sessionId: string | undefined,
): Promise<{ body: string; planned: boolean }> {
	if (!sessionId) return { body: "", planned: false };
	await generateTodoSummary({ workspaceId, sessionId });
	const plan = await listTodos({ workspaceId, sessionId });
	return { body: renderPrBody(plan), planned: flatItems(plan).length > 0 };
}

export async function previewPr(params: PreviewPrParams): Promise<PrPreview> {
	const ws = getWorkspace(params.workspaceId);
	const [templates, plan] = await Promise.all([
		discoverTemplates(ws.worktreePath),
		sessionPlan(params.workspaceId, params.sessionId),
	]);
	const source = params.source ?? (plan.planned ? "plan" : "commits");
	let body = "";
	if (source === "plan") body = plan.body;
	else if (source === "commits") {
		body = (await commitSubjects(ws.worktreePath, ws.baseBranch)).map((s) => `- ${s}`).join("\n");
	} else if (source === "template") {
		body = (await readTemplate(ws.worktreePath, templates, params.template)) ?? "";
	}
	return {
		title: params.title?.trim() || ws.branch,
		body,
		templates,
		planAvailable: plan.body !== "",
		source,
	};
}

export interface PrDraftInput {
	branch: string;
	base: string;
	commits: string[];
	diffStat: string;
	plan?: string;
	template?: string;
}

export async function prDraftInput(params: {
	workspaceId: string;
	sessionId?: string;
	template?: string;
}): Promise<PrDraftInput> {
	const ws = getWorkspace(params.workspaceId);
	const base = ws.baseBranch;
	const [commits, stat, plan, templates] = await Promise.all([
		commitSubjects(ws.worktreePath, base),
		isSafeRef(base)
			? gitAsync(ws.worktreePath, [
					"diff",
					"--stat=120",
					"--end-of-options",
					`${base}...HEAD`,
					"--",
				])
			: null,
		sessionPlan(params.workspaceId, params.sessionId),
		params.template === undefined ? null : discoverTemplates(ws.worktreePath),
	]);
	const template = templates
		? await readTemplate(ws.worktreePath, templates, params.template)
		: null;
	const statLines = stat?.ok ? stat.out.split("\n") : [];
	return {
		branch: ws.branch,
		base: baseRef(base),
		commits,
		diffStat:
			statLines.length > DIFF_STAT_MAX_LINES
				? [...statLines.slice(0, DIFF_STAT_MAX_LINES - 1), ...statLines.slice(-1)].join("\n")
				: statLines.join("\n"),
		...(plan.body ? { plan: plan.body } : {}),
		...(template ? { template } : {}),
	};
}

const PUSH_AUTH_PATTERNS = [
	/permission denied \(publickey/i,
	/could not read (username|password)/i,
	/authentication failed/i,
	/terminal prompts disabled/i,
	/host key verification failed/i,
];

export function isPushAuthFailure(stderr: string): boolean {
	return PUSH_AUTH_PATTERNS.some((p) => p.test(stderr));
}

export function pushGitEnv(
	base: Record<string, string | undefined>,
	hasSshCommandConfig: boolean,
): Record<string, string | undefined> {
	const keepSsh = hasSshCommandConfig || base.GIT_SSH_COMMAND || base.GIT_SSH;
	const env: Record<string, string | undefined> = {
		...base,
		GIT_TERMINAL_PROMPT: "0",
		LC_MESSAGES: "C",
		...(base.LC_ALL && !base.LC_CTYPE ? { LC_CTYPE: base.LC_ALL } : {}),
		...(keepSsh ? {} : { GIT_SSH_COMMAND: "ssh -oBatchMode=yes" }),
	};
	delete env.LC_ALL;
	return env;
}

export function githubSlug(remoteUrl: string): string | null {
	const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
	return match ? `${match[1]}/${match[2]}` : null;
}

export function gitlabProject(remoteUrl: string): string | null {
	const match = /gitlab\.com[/:]((?:[^/\s]+\/)+[^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
	return match?.[1] ?? null;
}

export function gitlabNewMrUrl(
	project: string,
	baseBranch: string,
	branch: string,
	title: string,
	body: string,
): string {
	const query = new URLSearchParams({
		"merge_request[source_branch]": branch,
		"merge_request[target_branch]": baseRef(baseBranch),
		"merge_request[title]": title,
	});
	if (body) query.set("merge_request[description]", body.slice(0, COMPARE_BODY_LIMIT));
	return `https://gitlab.com/${project}/-/merge_requests/new?${query}`;
}

export function baseRef(baseBranch: string): string {
	return baseBranch.replace(/^origin\//, "");
}

export function onBaseBranch(ws: { branch: string; baseBranch: string }): boolean {
	return ws.branch === baseRef(ws.baseBranch);
}

export function compareQuickPullUrl(
	slug: string,
	baseBranch: string,
	branch: string,
	title: string,
	body: string,
): string {
	const base = baseRef(baseBranch);
	const query = new URLSearchParams({ quick_pull: "1", title });
	if (body) query.set("body", body.slice(0, COMPARE_BODY_LIMIT));
	return `https://github.com/${slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?${query}`;
}

export async function ghPrFlow(
	cwd: string,
	branch: string,
	input: {
		slug: string;
		base: string;
		title: string;
		titleEdited?: boolean;
		body: string;
		draft?: boolean;
	},
	run: PrCommandRunner,
): Promise<Pick<OpenPrResult, "action" | "review" | "url" | "bodyRefreshed"> | null> {
	const prUrl = (n: number) => `https://github.com/${input.slug}/pull/${n}`;
	const listOpenPr = async (): Promise<number | null> => {
		const listed = await run(cwd, [
			"gh",
			"pr",
			"list",
			"--repo",
			input.slug,
			"--head",
			branch,
			"--base",
			input.base,
			"--state",
			"open",
			"--json",
			"number",
			"--limit",
			"1",
		]);
		return listed.ok ? reviewNumber(listed.out, "number") : null;
	};
	const existing = await listOpenPr();
	if (existing !== null) {
		const edited = await run(
			cwd,
			[
				"gh",
				"pr",
				"edit",
				String(existing),
				"--repo",
				input.slug,
				...(input.titleEdited ? ["--title", input.title] : []),
				"--body",
				input.body,
			],
			MUTATION_TIMEOUT_MS,
		);
		return {
			action: "updated",
			review: { kind: "pull-request", number: existing },
			url: prUrl(existing),
			bodyRefreshed: edited.ok,
		};
	}
	const created = await run(
		cwd,
		[
			"gh",
			"pr",
			"create",
			"--repo",
			input.slug,
			"--base",
			input.base,
			"--head",
			branch,
			"--title",
			input.title,
			"--body",
			input.body,
			...(input.draft ? ["--draft"] : []),
		],
		MUTATION_TIMEOUT_MS,
	);
	const url = created.ok
		? created.out
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => /^https:\/\/github\.com\/.+\/pull\/\d+$/.test(line))
				.pop()
		: undefined;
	const number = url ? Number(/\/pull\/(\d+)$/.exec(url)?.[1]) : Number.NaN;
	if (url && Number.isSafeInteger(number)) {
		return { action: "created", review: { kind: "pull-request", number }, url };
	}
	// A failed create may still exist server-side — dropping this re-check invites duplicates, see SPEC.
	const recheck = await listOpenPr();
	if (recheck !== null) {
		return {
			action: "created",
			review: { kind: "pull-request", number: recheck },
			url: prUrl(recheck),
		};
	}
	return null;
}

/** Every push to origin runs here: one non-interactive env and one auth-failure classification. */
export async function pushOrigin(
	cwd: string,
	args: string[],
): Promise<{ ok: true } | { err: string }> {
	const hasSshCommandConfig = git(cwd, ["config", "core.sshCommand"]).ok;
	const pushed = await gitAsync(cwd, ["push", ...args], {
		env: pushGitEnv(process.env, hasSshCommandConfig),
		network: true,
	});
	if (pushed.ok) return { ok: true };
	const detail = pushed.err || "git push failed";
	if (isPushAuthFailure(detail)) throw new CodedError("PUSH_AUTH_FAILED", detail);
	return { err: detail };
}

async function pushToOrigin(cwd: string, branch: string): Promise<string> {
	const origin = (await originUrls(cwd)).push;
	if (!origin) throw new Error("This workspace's repository has no 'origin' remote to push to.");
	const pushed = await pushOrigin(cwd, ["--set-upstream", "origin", branch]);
	if ("err" in pushed) throw new Error(pushed.err);
	forgetOpenBranchReview(cwd);
	return origin;
}

export function refreshedWorkspace(workspaceId: string, expectedBranch: string | undefined) {
	refreshUserOwnedWorkspace(workspaceId);
	const ws = getWorkspace(workspaceId);
	assertSafeRef(ws.branch);
	if (expectedBranch !== undefined && ws.branch !== expectedBranch) {
		throw new Error(
			`The checkout moved from "${expectedBranch}" to "${ws.branch}" — nothing was pushed. Review the branch and try again.`,
		);
	}
	return ws;
}

function pushWorkspace(workspaceId: string, branch: string, confirmBase: boolean) {
	const ws = refreshedWorkspace(workspaceId, branch);
	if (onBaseBranch(ws) && !confirmBase) {
		throw new Error(
			`"${ws.branch}" is this workspace's base branch — pushing it publishes the commits straight to the shared branch. Confirm the push first.`,
		);
	}
	return ws;
}

export async function pushBranch(params: {
	workspaceId: string;
	branch: string;
	confirmBase?: boolean;
}): Promise<{ dirtyFiles: number }> {
	const confirmBase = params.confirmBase === true;
	pushWorkspace(params.workspaceId, params.branch, confirmBase);
	const dirtyFiles = (await gitStatus(params.workspaceId, { kind: "uncommitted" })).changes.length;
	const ws = pushWorkspace(params.workspaceId, params.branch, confirmBase);
	await pushToOrigin(ws.worktreePath, ws.branch);
	return { dirtyFiles };
}

function prWorkspace(workspaceId: string, expectedBranch: string | undefined) {
	const ws = refreshedWorkspace(workspaceId, expectedBranch);
	const baseRemote = remoteNameOf(ws.baseBranch, listRemotes(ws.worktreePath));
	const unconfiguredTrackingRef =
		baseRemote === null &&
		!ws.baseBranch.startsWith("origin/") &&
		ws.baseBranch.includes("/") &&
		remoteRefOid(ws.worktreePath, ws.baseBranch) !== null;
	if ((baseRemote !== null && baseRemote !== "origin") || unconfiguredTrackingRef) {
		throw new Error(
			`Cannot open a PR from non-origin remote base "${ws.baseBranch}". Open it manually or create a workspace from a local or origin base.`,
		);
	}
	if (onBaseBranch(ws)) {
		throw new Error(
			`"${ws.branch}" is this workspace's base branch — there's nothing to open a PR against. Switch to a feature branch first.`,
		);
	}
	return ws;
}

export async function openPr(
	params: OpenPrParams,
	run: PrCommandRunner = runProviderCommand,
	ghProblem: () => Promise<GhSetupProblem | null> = ghSetupProblem,
): Promise<OpenPrHostResult> {
	// Default/external workspaces are user-owned checkouts the fs watcher re-syncs asynchronously —
	// resolve the live branch synchronously here so a switch made in a terminal just before Open PR
	// can never push/open/compare against a stale one (see SPEC). A no-op for created workspaces,
	// whose branch is ThinkRail-owned and never drifts externally.
	prWorkspace(params.workspaceId, params.branch);
	const dirtyFiles = (await gitStatus(params.workspaceId, { kind: "uncommitted" })).changes.length;
	const ws = prWorkspace(params.workspaceId, params.branch);
	const cwd = ws.worktreePath;
	const origin = await pushToOrigin(cwd, ws.branch);

	const provider = providerFromRemoteUrl(origin);
	const title = params.title?.trim() || ws.branch;
	const prBody = async () =>
		params.body ??
		(
			await previewPr({
				workspaceId: params.workspaceId,
				...(params.sessionId ? { sessionId: params.sessionId, source: "plan" as const } : {}),
			})
		).body;
	const gitlab = provider === "gitlab" ? gitlabProject(origin) : null;
	if (gitlab) {
		return {
			action: "compare",
			branch: ws.branch,
			compareUrl: gitlabNewMrUrl(gitlab, ws.baseBranch, ws.branch, title, await prBody()),
			dirtyFiles,
		};
	}
	const slug = provider === "github" ? githubSlug(origin) : null;
	if (!slug) return { action: "pushed", dirtyFiles, branch: ws.branch };

	const body = await prBody();
	let problem: GhSetupProblem | null = null;
	if (process.env.THINKRAIL_GH_OFFLINE !== "1") {
		const outcome = await ghPrFlow(
			cwd,
			ws.branch,
			{
				slug,
				base: baseRef(ws.baseBranch),
				title,
				body,
				...(params.titleEdited ? { titleEdited: true } : {}),
				...(params.draft ? { draft: true } : {}),
			},
			run,
		).finally(() => forgetOpenBranchReview(cwd));
		if (outcome) return { ...outcome, dirtyFiles, branch: ws.branch };
		problem = await ghProblem();
	}
	return {
		action: "compare",
		branch: ws.branch,
		compareUrl: compareQuickPullUrl(slug, ws.baseBranch, ws.branch, title, body),
		...(problem ? { ghProblem: problem } : {}),
		dirtyFiles,
	};
}
