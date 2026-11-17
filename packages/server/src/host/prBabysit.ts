import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import {
	normalizePrBabysitConfig,
	type PrBabysitConfig,
	type PrBabysitEvent,
	prBabysitConfigPatchProblem,
	type WireModel,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	abortSession,
	getSessionWorkspaceId,
	hasSession,
	promptSession,
	readFinalAssistantTexts,
	renameSession,
	runReviewSubagent,
} from "../agent";
import { githubSlug } from "../branch-review";
import { gitAsync, originUrls } from "../git";
import { logger } from "../log";
import { loadPrBabysitStore, loadWorkspaces, savePrBabysitStore } from "../persistence";
import {
	type BabysitAgent,
	type BabysitEngine,
	createBabysitEngine,
	createPrBabysitStore,
	runGh,
} from "../pr-babysit";
import { getConfig } from "../settings";
import { assertNotChatWorkspace, getWorkspace } from "../workspaces";
import { startChatSession } from "./chatSession";
import { resolveNewChatModel } from "./newChatModel";
import { findWorkspaceReviewOutcome } from "./settledLifecycle";

const log = logger("pr-babysit");

const FIX_TIMEOUT_MS = 45 * 60_000;
const SPEC_READ_LIMIT_BYTES = 256 * 1024;

type SettleWaiter = () => void;
const settleWaiters = new Map<string, Set<SettleWaiter>>();

/** Fed every session event by `server.ts`; resolves the fixer's wait at `agent_settled`, never `agent_end`. */
export function observePrBabysitSessionEvent(sessionId: string, event: { type: string }): void {
	if (event.type !== "agent_settled") return;
	const waiters = settleWaiters.get(sessionId);
	if (!waiters) return;
	settleWaiters.delete(sessionId);
	for (const resolve of waiters) resolve();
}

function waitForSettled(sessionId: string, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const waiters = settleWaiters.get(sessionId) ?? new Set<SettleWaiter>();
		settleWaiters.set(sessionId, waiters);
		const timer = setTimeout(() => done(new Error("The fix run took too long")), FIX_TIMEOUT_MS);
		const onAbort = () => done(new Error("PR babysitting stopped"));
		const settle = () => done();
		function done(error?: Error) {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			waiters.delete(settle);
			if (waiters.size === 0 && settleWaiters.get(sessionId) === waiters)
				settleWaiters.delete(sessionId);
			if (error) reject(error);
			else resolve();
		}
		waiters.add(settle);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function worktreeOf(workspaceId: string): string | null {
	return loadWorkspaces().find((workspace) => workspace.id === workspaceId)?.worktreePath ?? null;
}

/** A worktree-relative text file, contained by real path and size-capped; `null` when absent or outside. */
function readContainedFile(cwd: string, path: string): string | null {
	try {
		const root = realpathSync(cwd);
		const target = realpathSync(join(root, path));
		const rel = relative(root, target);
		if (rel.startsWith("..") || isAbsolute(rel)) return null;
		if (statSync(target).size > SPEC_READ_LIMIT_BYTES) return null;
		return readFileSync(target, "utf8");
	} catch {
		return null;
	}
}

async function reviewerModel(configured: WireModel | null) {
	const model = configured ?? getConfig().reviewModel ?? (await resolveNewChatModel({})).model;
	return model ? { provider: model.provider, id: model.id } : undefined;
}

const agent: BabysitAgent = {
	async ensureChat({ workspaceId, title, model, existing }) {
		if (existing && hasSession(existing) && getSessionWorkspaceId(existing) === workspaceId)
			return existing;
		const workspace = getWorkspace(workspaceId);
		const created = await startChatSession(workspace, model ? { model } : {});
		await renameSession(created.sessionId, workspaceId, workspace.worktreePath, title).catch(
			(error) => log.warn("babysit chat could not be named", error),
		);
		return created.sessionId;
	},
	async runFix(sessionId, prompt, signal) {
		const run = new AbortController();
		const onStop = () => {
			run.abort();
			void abortSession(sessionId).catch((error) => log.warn("babysit fix abort failed", error));
		};
		signal.addEventListener("abort", onStop, { once: true });
		try {
			const settled = waitForSettled(sessionId, run.signal);
			try {
				await promptSession(sessionId, prompt);
			} catch (error) {
				run.abort();
				await settled.catch(() => {});
				throw error;
			}
			await settled;
		} finally {
			signal.removeEventListener("abort", onStop);
		}
		const workspaceId = getSessionWorkspaceId(sessionId);
		const cwd = workspaceId ? worktreeOf(workspaceId) : null;
		if (!workspaceId || !cwd) return null;
		return (await readFinalAssistantTexts(workspaceId, cwd, [sessionId])).get(sessionId) ?? null;
	},
	async runReviewer(input, signal) {
		const model = await reviewerModel(input.model);
		const run = await runReviewSubagent(
			input.workspaceId,
			input.parentSessionId,
			input.task,
			{ systemPrompt: input.systemPrompt, tools: input.tools, ...(model ? { model } : {}) },
			signal,
		);
		return {
			text: run.status === "completed" ? (run.finalText ?? null) : null,
			...(model ? { model: `${model.provider}/${model.id}` } : {}),
		};
	},
};

let publish: (event: PrBabysitEvent) => void = () => {};

export function setPrBabysitPublisher(fn: ((event: PrBabysitEvent) => void) | null): void {
	publish = fn ?? (() => {});
}

let engine: BabysitEngine | null = null;

export function prBabysitEngine(): BabysitEngine {
	engine ??= createBabysitEngine({
		store: createPrBabysitStore({ load: loadPrBabysitStore, save: savePrBabysitStore }),
		gh: runGh,
		git: (cwd, args) => gitAsync(cwd, args),
		agent,
		worktreeOf,
		readFile: readContainedFile,
		publish: (event) => publish(event),
		schedule(fn, ms) {
			const timer = setTimeout(fn, ms);
			timer.unref?.();
			return () => clearTimeout(timer);
		},
		now: Date.now,
		onError: (scope, error) => log.warn(`babysit ${scope} failed`, error),
	});
	return engine;
}

export function disposePrBabysit(): void {
	engine?.dispose();
	engine = null;
}

/** Resolves the workspace's open GitHub PR on the host — the client never names a repo, PR, or path. */
export async function startPrBabysit(
	workspaceId: string,
	patch: Partial<PrBabysitConfig> | undefined,
) {
	if (patch !== undefined) {
		const problem = prBabysitConfigPatchProblem(patch);
		if (problem) throw new Error(`config ${problem}`);
	}
	const workspace = getWorkspace(workspaceId);
	assertNotChatWorkspace(workspace, "babysat as a pull request");
	const outcome = await findWorkspaceReviewOutcome(workspace, { fresh: true });
	const review = outcome.value;
	if (review?.kind !== "pull-request" || (review.state ?? "open") !== "open") {
		throw new CodedError(
			"PR_BABYSIT_NO_PR",
			"This workspace's branch has no open GitHub pull request",
		);
	}
	const remotes = await originUrls(workspace.worktreePath);
	const slug = githubSlug(remotes.push ?? remotes.fetch ?? "");
	const [owner, repo] = slug?.split("/") ?? [];
	if (!owner || !repo)
		throw new CodedError("PR_BABYSIT_NOT_GITHUB", "Babysitting needs a github.com origin remote");
	return prBabysitEngine().start({
		workspaceId,
		owner,
		repo,
		prNumber: review.number,
		config: normalizePrBabysitConfig({ ...getConfig().prBabysit, ...patch }),
	});
}
