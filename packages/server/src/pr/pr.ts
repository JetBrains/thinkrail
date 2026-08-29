import type { GhSetupProblem, OpenPrResult, PrDraft } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { providerFromRemoteUrl, reviewNumber, runProviderCommand } from "../branch-review";
import { assertSafeRef, git, gitAsync, gitStatus } from "../git";
import { ghSetupProblem } from "../github";
import { listTodos } from "../todos";
import { getWorkspace, refreshUserOwnedWorkspace } from "../workspaces";
import { renderPrBody } from "./prBody";

const COMPARE_BODY_LIMIT = 4_000;

export type PrCommandRunner = (
	cwd: string,
	command: string[],
	timeoutMs?: number,
) => Promise<{ ok: boolean; out: string }>;

const MUTATION_TIMEOUT_MS = 60_000;

export interface OpenPrParams {
	workspaceId: string;
	sessionId: string;
	title?: string;
	titleEdited?: boolean;
	body?: string;
	draft?: boolean;
}

export async function previewPr(params: {
	workspaceId: string;
	sessionId: string;
	title?: string;
}): Promise<PrDraft> {
	const ws = getWorkspace(params.workspaceId);
	return {
		title: params.title?.trim() || ws.branch,
		body: renderPrBody(await listTodos(params)),
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

export function nonInteractiveGitEnv(
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

export function baseRef(baseBranch: string): string {
	return baseBranch.replace(/^origin\//, "");
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

export async function openPr(
	params: OpenPrParams,
	run: PrCommandRunner = runProviderCommand,
	ghProblem: () => Promise<GhSetupProblem | null> = ghSetupProblem,
): Promise<OpenPrResult> {
	// Default/external workspaces are user-owned checkouts the fs watcher re-syncs asynchronously —
	// resolve the live branch synchronously here so a switch made in a terminal just before Open PR
	// can never push/open/compare against a stale one (see SPEC). A no-op for created workspaces,
	// whose branch is ThinkRail-owned and never drifts externally.
	refreshUserOwnedWorkspace(params.workspaceId);
	const ws = getWorkspace(params.workspaceId);
	assertSafeRef(ws.branch);
	if (ws.branch === baseRef(ws.baseBranch)) {
		throw new Error(
			`"${ws.branch}" is this workspace's base branch — there's nothing to open a PR against. Switch to a feature branch first.`,
		);
	}
	const cwd = ws.worktreePath;
	const origin = git(cwd, ["remote", "get-url", "origin"]);
	if (!origin.ok) throw new Error("This workspace's repository has no 'origin' remote to push to.");
	const dirtyFiles = (await gitStatus(params.workspaceId, { kind: "uncommitted" })).changes.length;
	const hasSshCommandConfig = git(cwd, ["config", "core.sshCommand"]).ok;
	const pushed = await gitAsync(cwd, ["push", "--set-upstream", "origin", ws.branch], {
		env: nonInteractiveGitEnv(process.env, hasSshCommandConfig),
	});
	if (!pushed.ok) {
		const detail = pushed.err || "git push failed";
		if (isPushAuthFailure(detail)) throw new CodedError("PUSH_AUTH_FAILED", detail);
		throw new Error(detail);
	}

	const slug = providerFromRemoteUrl(origin.out) === "github" ? githubSlug(origin.out) : null;
	if (!slug) return { action: "pushed", dirtyFiles };

	const draft = await previewPr(params);
	const title = draft.title;
	const body = params.body ?? draft.body;
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
		);
		if (outcome) return { ...outcome, dirtyFiles };
		problem = await ghProblem();
	}
	return {
		action: "compare",
		compareUrl: compareQuickPullUrl(slug, ws.baseBranch, ws.branch, title, body),
		...(problem ? { ghProblem: problem } : {}),
		dirtyFiles,
	};
}
