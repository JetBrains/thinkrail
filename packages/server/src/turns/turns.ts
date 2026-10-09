import type { GitDiffScope, PiEvent, TurnChangeSet } from "@thinkrail/contracts";
import { gitStatus, snapshotWorktree } from "../git";
import { logger } from "../log";
import { loadTurns, loadWorkspaces, saveTurns } from "../persistence";

const log = logger("turns");
const TURNS_PER_WORKSPACE = 30;
const DRAIN_TIMEOUT_MS = 5_000;

interface PendingRun {
	workspaceId: string;
	worktreePath: string;
	startedAt: number;
	baseTree: Promise<string | null>;
}

type TurnPublisher = (turn: TurnChangeSet) => void;
let publishTurn: TurnPublisher = () => {};

export function setTurnPublisher(fn: TurnPublisher): void {
	publishTurn = fn;
}

export function turnScope(turn: TurnChangeSet): Extract<GitDiffScope, { kind: "turn" }> {
	return {
		kind: "turn",
		id: turn.id,
		baseTree: turn.baseTree,
		headTree: turn.headTree,
		startedAt: turn.startedAt,
	};
}

export function listTurns(workspaceId: string): TurnChangeSet[] {
	return loadTurns().byWorkspace[workspaceId] ?? [];
}

export function forgetWorkspaceTurns(workspaceId: string): void {
	const turns = loadTurns();
	if (!(workspaceId in turns.byWorkspace)) return;
	const { [workspaceId]: _dropped, ...byWorkspace } = turns.byWorkspace;
	saveTurns({ ...turns, byWorkspace });
}

function recordTurn(turn: TurnChangeSet): void {
	const turns = loadTurns();
	const existing = turns.byWorkspace[turn.workspaceId] ?? [];
	const next = [...existing.filter((t) => t.id !== turn.id), turn]
		.sort((a, b) => a.startedAt - b.startedAt)
		.slice(-TURNS_PER_WORKSPACE);
	saveTurns({ ...turns, byWorkspace: { ...turns.byWorkspace, [turn.workspaceId]: next } });
}

export class TurnTracker {
	private readonly pending = new Map<string, PendingRun>();
	private readonly recording = new Set<Promise<void>>();

	constructor(
		private readonly resolve: (
			sessionId: string,
		) => { workspaceId: string; worktreePath: string } | null,
		private readonly now: () => number = Date.now,
		private readonly snapshot: (worktreePath: string) => Promise<string | null> = snapshotWorktree,
	) {}

	observe(sessionId: string, event: PiEvent): Promise<void> {
		if (event.type === "agent_start") {
			if (this.pending.has(sessionId)) return Promise.resolve();
			const target = this.resolve(sessionId);
			if (!target) return Promise.resolve();
			const baseTree = this.snapshot(target.worktreePath).catch(() => null);
			this.pending.set(sessionId, { ...target, startedAt: this.now(), baseTree });
			return baseTree.then(() => {});
		}
		if (event.type !== "agent_settled") return Promise.resolve();
		const run = this.pending.get(sessionId);
		this.pending.delete(sessionId);
		if (!run) return Promise.resolve();
		const headTree = this.snapshot(run.worktreePath);
		const job = this.settle(sessionId, run, headTree).catch((error) => {
			log.warn(`turn change set was not recorded for ${sessionId}`, error as Error);
		});
		this.recording.add(job);
		void job.then(() => this.recording.delete(job));
		return job;
	}

	async drain(timeoutMs = DRAIN_TIMEOUT_MS): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.all(this.recording),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
			}),
		]);
		clearTimeout(timer);
	}

	private async settle(
		sessionId: string,
		run: PendingRun,
		head: Promise<string | null>,
	): Promise<void> {
		const [baseTree, headTree] = await Promise.all([run.baseTree, head]);
		if (!baseTree || !headTree || headTree === baseTree) return;
		const id = `${sessionId}:${run.startedAt}`;
		const status = await gitStatus(run.workspaceId, {
			kind: "turn",
			id,
			baseTree,
			headTree,
			startedAt: run.startedAt,
		});
		if (status.changes.length === 0) return;
		if (!loadWorkspaces().some((workspace) => workspace.id === run.workspaceId)) return;
		const turn: TurnChangeSet = {
			id,
			workspaceId: run.workspaceId,
			sessionId,
			startedAt: run.startedAt,
			settledAt: this.now(),
			baseTree,
			headTree,
			changes: status.changes,
		};
		recordTurn(turn);
		publishTurn(turn);
	}
}
