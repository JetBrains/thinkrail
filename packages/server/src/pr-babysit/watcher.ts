import {
	PR_BABYSIT_MARKER,
	type PrBabysitConfig,
	type PrBabysitEventKind,
	type PrBabysitItem,
	type PrBabysitItemAction,
	type PrBabysitItemStatus,
	type PrBabysitSessionState,
	type WireModel,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	fetchFailedRunLog,
	fetchPrSnapshot,
	fetchViewerLogin,
	type GhRunner,
	type PrRef,
	type PrSnapshot,
	postPrReview,
	replyToReviewComment,
	resolveReviewThread,
} from "./github";
import {
	buildPatchCheckTask,
	buildReviewTask,
	PR_REVIEWER_SYSTEM_PROMPT,
	parsePatchVerdict,
	parseReviewFindings,
	READ_ONLY_REVIEWER_TOOLS,
	renderGithubReview,
	specPathsFor,
} from "./reviewer";
import {
	applyFindings,
	cycleCapReached,
	hasActiveWork,
	nextQueuedItem,
	type PrBabysitStore,
	syncSnapshotItems,
	transitionItem,
} from "./store";

export const ACTIVE_POLL_MS = 30_000;
export const IDLE_POLL_MS = 120_000;

export interface GitRun {
	ok: boolean;
	out: string;
	err?: string;
}

export type GitRunner = (cwd: string, args: string[]) => Promise<GitRun>;

export interface ReviewerRun {
	text: string | null;
	/** `provider/id` the reviewer actually ran on. */
	model?: string;
}

/** The agent operations the host composes from `agent`; pr-babysit never imports `agent` itself. */
export interface BabysitAgent {
	/** The workspace chat the fixer runs in (reused while it still exists). */
	ensureChat(input: {
		workspaceId: string;
		cwd: string;
		title: string;
		model: WireModel | null;
		existing: string | undefined;
	}): Promise<string>;
	/** Prompt that chat and resolve with its final text once the run settles. */
	runFix(sessionId: string, prompt: string, signal: AbortSignal): Promise<string | null>;
	/** A hidden, read-only reviewer child of `parentSessionId`. */
	runReviewer(
		input: {
			workspaceId: string;
			parentSessionId: string;
			task: string;
			systemPrompt: string;
			tools: string[];
			model: WireModel | null;
		},
		signal: AbortSignal,
	): Promise<ReviewerRun>;
}

export interface BabysitDeps {
	store: PrBabysitStore;
	gh: GhRunner;
	git: GitRunner;
	agent: BabysitAgent;
	/** The workspace's worktree, or `null` once it is gone. */
	worktreeOf(workspaceId: string): string | null;
	readFile(cwd: string, path: string): string | null;
	publish(event: {
		workspaceId: string;
		kind: PrBabysitEventKind;
		itemId?: string;
		state: PrBabysitSessionState | null;
	}): void;
	schedule(fn: () => void, ms: number): () => void;
	now(): number;
	onError?(scope: string, error: unknown): void;
}

export interface StartInput {
	workspaceId: string;
	owner: string;
	repo: string;
	prNumber: number;
	config: PrBabysitConfig;
}

interface Runtime {
	cancelTimer: (() => void) | null;
	abort: AbortController;
	ticking: boolean;
	fixing: boolean;
	reviewing: boolean;
	snapshot: PrSnapshot | null;
}

const FIX_COMMIT_SUBJECT_LIMIT = 60;
const REPLY_EXPLANATION_LIMIT = 600;
const HUNK_CONTEXT_LINES = 40;

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function clip(text: string, max: number): string {
	const trimmed = text.trim();
	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function fixCommitMessage(item: Pick<PrBabysitItem, "summary">): string {
	return `fix(pr-review): ${clip(oneLine(item.summary), FIX_COMMIT_SUBJECT_LIMIT)}`;
}

export function replyBody(shortSha: string, explanation: string): string {
	const why = clip(explanation, REPLY_EXPLANATION_LIMIT);
	return `${PR_BABYSIT_MARKER} Fixed in ${shortSha}${why ? `: ${why}` : "."}`;
}

/** The hunk of `diff` around `line`, so the fixer sees the reviewed code without the whole PR. */
export function hunkAround(diff: string, line: number | undefined): string {
	if (!diff) return "";
	const lines = diff.split("\n");
	if (line === undefined) return lines.slice(0, HUNK_CONTEXT_LINES * 2).join("\n");
	let start = 0;
	for (let index = 0; index < lines.length; index++) {
		const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(lines[index] ?? "");
		if (!match) continue;
		const from = Number(match[1]);
		const count = Number(match[2] ?? "1");
		if (line >= from && line <= from + count) {
			start = index;
			break;
		}
	}
	return lines.slice(start, start + HUNK_CONTEXT_LINES * 2).join("\n");
}

export function buildFixPrompt(
	item: PrBabysitItem,
	context: {
		prNumber: number;
		headRefName: string;
		hunk: string;
		history: string;
		ciLog: string | null;
	},
): string {
	const where = item.path ? `\`${item.path}\`${item.line ? ` line ${item.line}` : ""}` : null;
	const source =
		item.source === "github_thread"
			? "a GitHub review thread"
			: item.source === "ci_check"
				? "a failing CI check"
				: "an independent reviewer finding";
	return [
		`${PR_BABYSIT_MARKER} Fix ${source} on PR #${context.prNumber} (branch \`${context.headRefName}\`).`,
		"",
		...(where ? [`Location: ${where}`, ""] : []),
		"## What to address",
		item.summary,
		...(item.suggestedFix ? ["", `Suggested fix: ${item.suggestedFix}`] : []),
		...(context.history ? ["", "## Thread history", context.history] : []),
		...(context.ciLog ? ["", "## Failing log (tail)", "```", context.ciLog, "```"] : []),
		...(context.hunk ? ["", "## Surrounding diff", "```diff", context.hunk, "```"] : []),
		"",
		"## Rules",
		"- Make the smallest change that resolves this item; touch nothing unrelated.",
		"- Run the project's lint and the tests that cover the change, and fix what you broke.",
		"- Do NOT commit, push, or reply on GitHub — the host commits, pushes, and replies for you.",
		"- If the item is wrong, unclear, or needs a product decision, change nothing and say why.",
		"- End with one or two sentences explaining what you changed; that text becomes the GitHub reply.",
	].join("\n");
}

export function createBabysitEngine(deps: BabysitDeps) {
	const runtimes = new Map<string, Runtime>();

	const prRef = (session: PrBabysitSessionState): PrRef => ({
		owner: session.owner,
		repo: session.repo,
		number: session.prNumber,
	});

	function mustSession(workspaceId: string): PrBabysitSessionState {
		const session = deps.store.get(workspaceId);
		if (!session) throw new CodedError("PR_BABYSIT_NOT_ACTIVE", "PR babysitting is not on here");
		return session;
	}

	function mustItem(session: PrBabysitSessionState, itemId: string): PrBabysitItem {
		const item = session.items.find((candidate) => candidate.itemId === itemId);
		if (!item) throw new CodedError("PR_BABYSIT_UNKNOWN_ITEM", "That item is no longer listed");
		return item;
	}

	function update(
		workspaceId: string,
		change: (session: PrBabysitSessionState) => PrBabysitSessionState,
		kind: PrBabysitEventKind = "state_changed",
		itemId?: string,
	): PrBabysitSessionState | null {
		const current = deps.store.get(workspaceId);
		if (!current) return null;
		const next = deps.store.put({ ...change(current), updatedAt: deps.now() });
		deps.publish({ workspaceId, kind, ...(itemId ? { itemId } : {}), state: next });
		return next;
	}

	function setItem(
		workspaceId: string,
		itemId: string,
		to: PrBabysitItemStatus,
		patch: Partial<Omit<PrBabysitItem, "itemId" | "status">> = {},
		kind: PrBabysitEventKind = "state_changed",
	): PrBabysitSessionState | null {
		return update(
			workspaceId,
			(session) => ({
				...session,
				items: session.items.map((item) =>
					item.itemId === itemId ? transitionItem(item, to, deps.now(), patch) : item,
				),
			}),
			kind,
			itemId,
		);
	}

	function needsHuman(workspaceId: string, itemId: string, message: string, commitSha?: string) {
		setItem(
			workspaceId,
			itemId,
			"needs_human",
			{ errorMessage: message, ...(commitSha ? { commitSha } : {}) },
			"needs_human",
		);
	}

	function schedule(workspaceId: string) {
		const runtime = runtimes.get(workspaceId);
		const session = deps.store.get(workspaceId);
		if (!runtime || !session?.active) return;
		runtime.cancelTimer?.();
		const delay = hasActiveWork(session) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
		runtime.cancelTimer = deps.schedule(() => void tick(workspaceId), delay);
	}

	function stopRuntime(workspaceId: string) {
		const runtime = runtimes.get(workspaceId);
		if (!runtime) return;
		runtime.cancelTimer?.();
		runtime.abort.abort();
		runtimes.delete(workspaceId);
	}

	function finish(workspaceId: string, status: "merged" | "closed" | "error", error?: string) {
		stopRuntime(workspaceId);
		update(
			workspaceId,
			(session) => {
				const next: PrBabysitSessionState = { ...session, active: false, status, reviewing: false };
				if (error) next.error = error;
				return next;
			},
			"stopped",
		);
	}

	async function git(cwd: string, args: string[], step: string): Promise<string> {
		const result = await deps.git(cwd, args);
		if (!result.ok)
			throw new Error(`git ${step} failed${result.err ? `: ${clip(result.err, 300)}` : ""}`);
		return result.out;
	}

	async function tick(workspaceId: string): Promise<void> {
		const runtime = runtimes.get(workspaceId);
		if (!runtime || runtime.ticking) return;
		runtime.ticking = true;
		try {
			const session = deps.store.get(workspaceId);
			if (!session?.active) return;
			const cwd = deps.worktreeOf(workspaceId);
			if (!cwd) {
				finish(workspaceId, "error", "The workspace's worktree is gone");
				return;
			}
			let snapshot: PrSnapshot;
			try {
				snapshot = await fetchPrSnapshot(deps.gh, cwd, prRef(session));
			} catch (error) {
				update(workspaceId, (current) => ({ ...current, error: messageOf(error) }));
				return;
			}
			if (!runtimes.has(workspaceId)) return;
			runtime.snapshot = snapshot;
			if (snapshot.state !== "OPEN") {
				finish(workspaceId, snapshot.state === "MERGED" ? "merged" : "closed");
				return;
			}
			const updated = update(workspaceId, (current) => {
				const synced = syncSnapshotItems(current, snapshot, deps.now());
				const next: PrBabysitSessionState = {
					...current,
					items: synced.items,
					headOid: snapshot.headRefOid,
					headRefName: snapshot.headRefName,
					baseRefName: snapshot.baseRefName,
					...(snapshot.url ? { prUrl: snapshot.url } : {}),
				};
				if (snapshot.checks) next.checks = snapshot.checks;
				else delete next.checks;
				delete next.error;
				return next;
			});
			if (!updated) return;
			if (
				updated.config.independentReviewMode !== "off" &&
				updated.headOid &&
				updated.headOid !== updated.lastReviewedOid
			)
				void runReview(workspaceId);
			void drain(workspaceId);
		} catch (error) {
			deps.onError?.("tick", error);
		} finally {
			runtime.ticking = false;
			schedule(workspaceId);
		}
	}

	async function prDiff(cwd: string, session: PrBabysitSessionState, args: string[] = []) {
		const base = `origin/${session.baseRefName}`;
		const head = session.headOid ?? "HEAD";
		const ranged = await deps.git(cwd, ["diff", `${base}...${head}`, ...args]);
		if (ranged.ok) return ranged.out;
		return git(cwd, ["diff", `${base}...HEAD`, ...args], "diff");
	}

	async function ensureChat(session: PrBabysitSessionState, cwd: string): Promise<string> {
		const sessionId = await deps.agent.ensureChat({
			workspaceId: session.workspaceId,
			cwd,
			title: `PR #${session.prNumber} babysit`,
			model: session.config.babysitModel,
			existing: session.babysitSessionId,
		});
		if (sessionId !== session.babysitSessionId)
			update(session.workspaceId, (current) => ({ ...current, babysitSessionId: sessionId }));
		return sessionId;
	}

	async function runReview(workspaceId: string, force = false): Promise<void> {
		const runtime = runtimes.get(workspaceId);
		const session = deps.store.get(workspaceId);
		if (!runtime || !session?.active || runtime.reviewing) return;
		if (!force && session.config.independentReviewMode === "off") return;
		const cwd = deps.worktreeOf(workspaceId);
		const headOid = session.headOid;
		if (!cwd || !headOid) return;
		runtime.reviewing = true;
		update(workspaceId, (current) => ({ ...current, reviewing: true }), "reviewer_started");
		let reviewError: string | undefined;
		try {
			await deps.git(cwd, ["fetch", "origin", session.baseRefName, session.headRefName]);
			const diff = await prDiff(cwd, session);
			const changed = (await prDiff(cwd, session, ["--name-only"]))
				.split("\n")
				.map((path) => path.trim())
				.filter(Boolean);
			const specs = specPathsFor(changed, (path) => deps.readFile(cwd, path) !== null).flatMap(
				(path) => {
					const text = deps.readFile(cwd, path);
					return text === null ? [] : [{ path, text }];
				},
			);
			const parentSessionId = await ensureChat(session, cwd);
			const run = await deps.agent.runReviewer(
				{
					workspaceId,
					parentSessionId,
					systemPrompt: PR_REVIEWER_SYSTEM_PROMPT,
					tools: READ_ONLY_REVIEWER_TOOLS,
					model: session.config.reviewerModel,
					task: buildReviewTask({
						owner: session.owner,
						repo: session.repo,
						prNumber: session.prNumber,
						baseRefName: session.baseRefName,
						headOid,
						changedPaths: changed,
						diff,
						specs,
					}),
				},
				runtime.abort.signal,
			);
			if (!runtimes.has(workspaceId)) return;
			const findings = run.text === null ? null : parseReviewFindings(run.text);
			if (findings === null) {
				reviewError = "The independent reviewer's answer could not be read";
				return;
			}
			let created: string[] = [];
			const next = update(workspaceId, (current) => {
				const applied = applyFindings(current, findings, headOid, run.model, deps.now());
				created = applied.created;
				return { ...current, items: applied.items };
			});
			for (const itemId of created)
				deps.publish({ workspaceId, kind: "finding_created", itemId, state: next });
			if (next?.config.independentReviewMode === "post_to_github" && created.length > 0) {
				const items = next.items.filter((item) => created.includes(item.itemId));
				await postFindings(workspaceId, items).catch((error) => {
					reviewError = messageOf(error);
				});
			}
		} catch (error) {
			if (!runtime.abort.signal.aborted) reviewError = messageOf(error);
		} finally {
			runtime.reviewing = false;
			update(
				workspaceId,
				(current) => {
					const next: PrBabysitSessionState = {
						...current,
						reviewing: false,
						lastReviewedOid: headOid,
					};
					if (reviewError) next.error = reviewError;
					return next;
				},
				"reviewer_finished",
			);
			void drain(workspaceId);
		}
	}

	async function postFindings(workspaceId: string, items: readonly PrBabysitItem[]) {
		const session = mustSession(workspaceId);
		const cwd = deps.worktreeOf(workspaceId);
		if (!cwd || !session.headOid || items.length === 0) return;
		const review = renderGithubReview(items);
		const ref = prRef(session);
		const attempts = [
			review,
			{ ...review, event: "COMMENT" as const },
			{
				event: "COMMENT" as const,
				body: renderGithubReview(items.map(({ path: _p, line: _l, ...rest }) => rest)).body,
				comments: [],
			},
		];
		let lastError: unknown = null;
		for (const attempt of attempts) {
			try {
				await postPrReview(deps.gh, cwd, ref, { ...attempt, commitId: session.headOid });
				lastError = null;
				break;
			} catch (error) {
				lastError = error;
			}
		}
		if (lastError) {
			throw new CodedError(
				"PR_BABYSIT_GH_FAILED",
				`Could not post the review: ${messageOf(lastError)}`,
			);
		}
		const ids = new Set(items.map((item) => item.itemId));
		update(workspaceId, (current) => ({
			...current,
			items: current.items.map((item) =>
				ids.has(item.itemId) ? { ...item, postedToGithub: true, updatedAt: deps.now() } : item,
			),
		}));
	}

	async function drain(workspaceId: string): Promise<void> {
		const runtime = runtimes.get(workspaceId);
		if (!runtime || runtime.fixing) return;
		runtime.fixing = true;
		try {
			while (runtimes.has(workspaceId)) {
				const session = deps.store.get(workspaceId);
				if (!session?.active) break;
				const item = nextQueuedItem(session);
				if (!item) break;
				if (session.config.mode === "auto_push" && cycleCapReached(session)) {
					deps.publish({ workspaceId, kind: "needs_human", state: session });
					break;
				}
				await fixItem(workspaceId, item.itemId).catch((error) => {
					if (!runtimes.has(workspaceId)) return;
					const current = deps.store.get(workspaceId);
					const stuck = current?.items.find((candidate) => candidate.itemId === item.itemId);
					if (stuck && (stuck.status === "working" || stuck.status === "queued"))
						needsHuman(workspaceId, item.itemId, messageOf(error));
				});
			}
		} finally {
			runtime.fixing = false;
			schedule(workspaceId);
		}
	}

	async function fixContext(session: PrBabysitSessionState, item: PrBabysitItem, cwd: string) {
		const runtime = runtimes.get(session.workspaceId);
		const snapshot = runtime?.snapshot;
		let history = "";
		let ciLog: string | null = null;
		if (item.source === "github_thread" && snapshot) {
			const thread = snapshot.threads.find((candidate) => candidate.id === item.threadId);
			history = (thread?.comments ?? [])
				.map((comment) => `@${comment.author}: ${clip(comment.body, 2000)}`)
				.join("\n\n");
		}
		if (item.source === "ci_check" && snapshot) {
			const check = snapshot.checkRuns.find((candidate) =>
				item.summary.startsWith(`${candidate.name} `),
			);
			if (check?.runId !== undefined)
				ciLog = await fetchFailedRunLog(deps.gh, cwd, session, check.runId);
		}
		const hunk = item.path
			? hunkAround(await prDiff(cwd, session, ["--", item.path]).catch(() => ""), item.line)
			: "";
		return { prNumber: session.prNumber, headRefName: session.headRefName, hunk, history, ciLog };
	}

	async function fixItem(workspaceId: string, itemId: string): Promise<void> {
		const runtime = runtimes.get(workspaceId);
		const cwd = deps.worktreeOf(workspaceId);
		if (!runtime || !cwd) return;
		const started = setItem(workspaceId, itemId, "working", {}, "item_working");
		if (!started) return;
		const session = started;
		const item = mustItem(session, itemId);
		if ((await git(cwd, ["status", "--porcelain"], "status")) !== "") {
			needsHuman(
				workspaceId,
				itemId,
				"The worktree has uncommitted changes; commit or stash them first",
			);
			return;
		}
		const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], "branch");
		if (branch !== session.headRefName) {
			needsHuman(
				workspaceId,
				itemId,
				`The worktree is on ${branch}, not the PR branch ${session.headRefName}`,
			);
			return;
		}
		await git(cwd, ["fetch", "origin", session.headRefName], "fetch");
		const synced = await deps.git(cwd, ["merge", "--ff-only", `origin/${session.headRefName}`]);
		if (!synced.ok) {
			needsHuman(workspaceId, itemId, "The PR branch diverged from the worktree; sync it by hand");
			return;
		}
		const before = await git(cwd, ["rev-parse", "HEAD"], "rev-parse");
		const chat = await ensureChat(session, cwd);
		const finalText = await deps.agent.runFix(
			chat,
			buildFixPrompt(item, await fixContext(session, item, cwd)),
			runtime.abort.signal,
		);
		if (!runtimes.has(workspaceId)) return;
		if ((await git(cwd, ["status", "--porcelain"], "status")) !== "") {
			await git(cwd, ["add", "-A"], "add");
			const explanation = clip(finalText ?? "", REPLY_EXPLANATION_LIMIT);
			await git(
				cwd,
				["commit", "-m", fixCommitMessage(item), ...(explanation ? ["-m", explanation] : [])],
				"commit",
			);
		}
		const after = await git(cwd, ["rev-parse", "HEAD"], "rev-parse");
		if (after === before) {
			needsHuman(
				workspaceId,
				itemId,
				clip(finalText ? `No change made: ${oneLine(finalText)}` : "The agent made no change", 400),
			);
			return;
		}
		const current = mustSession(workspaceId);
		if (current.config.independentReviewMode !== "off") {
			const patch = await git(cwd, ["diff", `${before}..${after}`], "diff");
			const check = await deps.agent
				.runReviewer(
					{
						workspaceId,
						parentSessionId: chat,
						systemPrompt: PR_REVIEWER_SYSTEM_PROMPT,
						tools: READ_ONLY_REVIEWER_TOOLS,
						model: current.config.reviewerModel,
						task: buildPatchCheckTask(item, patch),
					},
					runtime.abort.signal,
				)
				.catch(() => ({ text: null }));
			const verdict = parsePatchVerdict(check.text);
			if (!verdict.approved) {
				needsHuman(
					workspaceId,
					itemId,
					`The reviewer rejected the fix${verdict.reason ? `: ${verdict.reason}` : ""}`,
					after,
				);
				return;
			}
		}
		if (current.config.mode === "stage_for_approval" || cycleCapReached(current)) {
			setItem(workspaceId, itemId, "needs_human", { commitSha: after }, "needs_human");
			return;
		}
		setItem(workspaceId, itemId, "working", { commitSha: after });
		await pushAndReply(workspaceId, cwd, true);
	}

	async function pushAndReply(
		workspaceId: string,
		cwd: string,
		autonomous: boolean,
	): Promise<void> {
		const session = mustSession(workspaceId);
		await git(cwd, ["push", "origin", `HEAD:refs/heads/${session.headRefName}`], "push");
		const pending = session.items.filter(
			(item) => item.commitSha && (item.status === "working" || item.status === "needs_human"),
		);
		for (const item of pending) {
			const sha = item.commitSha as string;
			const contained = await deps.git(cwd, ["merge-base", "--is-ancestor", sha, "HEAD"]);
			if (!contained.ok) continue;
			let resolved = false;
			if (item.source === "github_thread" && item.lastCommentId !== undefined) {
				const body = (await deps.git(cwd, ["log", "-1", "--format=%b", sha])).out.trim();
				const subject = (await deps.git(cwd, ["log", "-1", "--format=%s", sha])).out.trim();
				try {
					await replyToReviewComment(
						deps.gh,
						cwd,
						prRef(session),
						item.lastCommentId,
						replyBody(sha.slice(0, 7), body || subject),
					);
					if (session.config.autoResolveThreads && item.threadId) {
						await resolveReviewThread(deps.gh, cwd, item.threadId);
						resolved = true;
					}
				} catch (error) {
					deps.onError?.("reply", error);
				}
			}
			setItem(workspaceId, item.itemId, resolved ? "resolved" : "pushed", {}, "item_pushed");
		}
		if (autonomous)
			update(workspaceId, (current) => ({ ...current, cycleCount: current.cycleCount + 1 }));
	}

	function ensureRuntime(workspaceId: string): Runtime {
		let runtime = runtimes.get(workspaceId);
		if (!runtime) {
			runtime = {
				cancelTimer: null,
				abort: new AbortController(),
				ticking: false,
				fixing: false,
				reviewing: false,
				snapshot: null,
			};
			runtimes.set(workspaceId, runtime);
		}
		return runtime;
	}

	return {
		async start(input: StartInput): Promise<PrBabysitSessionState> {
			const cwd = deps.worktreeOf(input.workspaceId);
			if (!cwd) throw new CodedError("PR_BABYSIT_NO_PR", "This workspace has no worktree");
			const viewerLogin = await fetchViewerLogin(deps.gh, cwd);
			const existing = deps.store.get(input.workspaceId);
			const samePr =
				existing &&
				existing.owner === input.owner &&
				existing.repo === input.repo &&
				existing.prNumber === input.prNumber;
			const base: PrBabysitSessionState = samePr
				? existing
				: {
						workspaceId: input.workspaceId,
						owner: input.owner,
						repo: input.repo,
						prNumber: input.prNumber,
						headRefName: "",
						baseRefName: "",
						active: true,
						status: "watching",
						config: input.config,
						cycleCount: 0,
						reviewing: false,
						items: [],
						updatedAt: deps.now(),
					};
			const session: PrBabysitSessionState = {
				...base,
				active: true,
				config: input.config,
				reviewing: false,
				...(viewerLogin ? { viewerLogin } : {}),
			};
			if (samePr && cycleCapReached(session)) session.cycleCount = 0;
			delete session.error;
			const stored = deps.store.put({ ...session, updatedAt: deps.now() });
			deps.publish({ workspaceId: input.workspaceId, kind: "state_changed", state: stored });
			ensureRuntime(input.workspaceId);
			void tick(input.workspaceId);
			return stored;
		},

		stop(workspaceId: string): PrBabysitSessionState | null {
			stopRuntime(workspaceId);
			return update(
				workspaceId,
				(session) => ({
					...session,
					active: false,
					status: "stopped",
					reviewing: false,
					items: session.items.map((item) =>
						item.status === "working" ? transitionItem(item, "queued", deps.now()) : item,
					),
				}),
				"stopped",
			);
		},

		get(workspaceId: string): PrBabysitSessionState | null {
			return deps.store.get(workspaceId);
		},

		triggerReview(workspaceId: string): PrBabysitSessionState {
			const session = mustSession(workspaceId);
			if (!session.active)
				throw new CodedError("PR_BABYSIT_NOT_ACTIVE", "Start babysitting this PR first");
			ensureRuntime(workspaceId);
			void runReview(workspaceId, true);
			return mustSession(workspaceId);
		},

		queueFinding(workspaceId: string, itemId: string): PrBabysitSessionState {
			mustItem(mustSession(workspaceId), itemId);
			const next = setItem(workspaceId, itemId, "queued") ?? mustSession(workspaceId);
			void drain(workspaceId);
			return next;
		},

		async postFinding(workspaceId: string, itemId: string): Promise<PrBabysitSessionState> {
			const item = mustItem(mustSession(workspaceId), itemId);
			await postFindings(workspaceId, [item]);
			return mustSession(workspaceId);
		},

		async approvePush(workspaceId: string, itemId: string): Promise<PrBabysitSessionState> {
			const item = mustItem(mustSession(workspaceId), itemId);
			if (item.status !== "needs_human" || !item.commitSha)
				throw new CodedError("PR_BABYSIT_BAD_TRANSITION", "There is no staged fix to push");
			const cwd = deps.worktreeOf(workspaceId);
			if (!cwd) throw new CodedError("PR_BABYSIT_NO_PR", "This workspace has no worktree");
			await pushAndReply(workspaceId, cwd, false);
			return mustSession(workspaceId);
		},

		itemAction(
			workspaceId: string,
			itemId: string,
			action: PrBabysitItemAction,
		): PrBabysitSessionState {
			mustItem(mustSession(workspaceId), itemId);
			const next =
				setItem(workspaceId, itemId, action === "retry" ? "queued" : "dismissed") ??
				mustSession(workspaceId);
			if (action === "retry") void drain(workspaceId);
			return next;
		},

		/** Restart the loops of sessions that were active when the host stopped. */
		resume(): void {
			for (const session of deps.store.list()) {
				if (!session.active || runtimes.has(session.workspaceId)) continue;
				ensureRuntime(session.workspaceId);
				void tick(session.workspaceId);
			}
		},

		/** Forget a removed workspace's session. */
		forget(workspaceId: string): void {
			stopRuntime(workspaceId);
			deps.store.remove(workspaceId);
			deps.publish({ workspaceId, kind: "stopped", state: null });
		},

		dispose(): void {
			for (const workspaceId of [...runtimes.keys()]) stopRuntime(workspaceId);
		},

		/** Test seam: run one poll now. */
		tick,
	};
}

export type BabysitEngine = ReturnType<typeof createBabysitEngine>;
