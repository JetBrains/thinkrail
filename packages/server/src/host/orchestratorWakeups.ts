import type {
	ChatState,
	Container,
	ContainerWakeDetails,
	ContainerWakeReason,
	PiEvent,
	SessionStateRecord,
	SessionSummary,
	Workspace,
} from "@thinkrail/contracts";
import { CONTAINER_WAKE_CUSTOM_TYPE, chatState } from "@thinkrail/contracts";
import {
	ensureSessionAttached,
	getSessionWorkspaceId,
	isHostMessagePending,
	listSessions,
	readFinalAssistantTexts,
	sendHostMessageToSession,
} from "../agent";
import { listContainers } from "../containers";
import { logger } from "../log";
import { getProjects } from "../projects";
import { countOpenTodos } from "../todos";
import {
	listAllWorkspaceRecords,
	orchestratorChat,
	type WorkspaceLifecycleEvent,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { runObservation } from "./runAnalytics";
import { chatName, clampFinalMessage, prLine } from "./workspaceTools";

const log = logger("host");

/** How long a member's burst of changes is gathered into one wake-up. */
const WAKE_WINDOW_MS = 1_500;

export interface WakeCard {
	text: string;
	details: ContainerWakeDetails;
}

export interface WakeupDeps {
	/** The container a workspace is a member of, if any. */
	containerOf: (workspaceId: string) => Container | undefined;
	describe: (
		container: Container,
		workspaceId: string,
		sessionIds: readonly string[],
		reasons: readonly ContainerWakeReason[],
	) => Promise<WakeCard | null>;
	/** Sends the card to the orchestrator's session, triggering (or, while it streams, queueing) its turn. */
	deliver: (container: Container, sessionId: string, card: WakeCard) => Promise<void>;
	/** Whether a card already sent still waits in the orchestrator's queue. */
	isPending: (sessionId: string, details: ContainerWakeDetails) => boolean;
	windowMs: number;
}

interface PendingWake {
	containerId: string;
	workspaceId: string;
	sessionIds: Set<string>;
	reasons: Set<ContainerWakeReason>;
	timer: ReturnType<typeof setTimeout> | null;
}

export interface OrchestratorWakeups {
	/** Baselines every workspace's review, so only a change of it wakes anyone. */
	seed(workspaces: readonly Workspace[]): void;
	onSessionEvent(sessionId: string, workspaceId: string, event: PiEvent): void;
	onSessionState(record: SessionStateRecord): void;
	onWorkspaceEvent(event: WorkspaceLifecycleEvent): void;
	/** Wake-ups gathering or being sent. */
	busy(): boolean;
	dispose(): void;
}

function reviewKey(workspace: Workspace): string {
	const review = workspace.review;
	return review ? `${review.kind}#${review.number}:${review.state ?? "open"}` : "";
}

const WAKING_STATES: ReadonlySet<ChatState> = new Set(["needs_you", "failed"]);

export function createOrchestratorWakeups(deps: WakeupDeps): OrchestratorWakeups {
	const pending = new Map<string, PendingWake>();
	const sending = new Set<string>();
	const lastSent = new Map<string, { sessionId: string; details: ContainerWakeDetails }>();
	const chatStates = new Map<string, ChatState>();
	const reviews = new Map<string, string>();

	const arm = (wake: PendingWake): void => {
		wake.timer = setTimeout(() => void fire(wake), deps.windowMs);
	};

	const stillQueued = (workspaceId: string, orchestrator: string): boolean => {
		const last = lastSent.get(workspaceId);
		return !!last && last.sessionId === orchestrator && deps.isPending(orchestrator, last.details);
	};

	async function fire(wake: PendingWake): Promise<void> {
		wake.timer = null;
		const container = deps.containerOf(wake.workspaceId);
		const orchestrator = container?.orchestratorSessionId;
		if (!container || !orchestrator || container.id !== wake.containerId) {
			pending.delete(wake.workspaceId);
			return;
		}
		if (sending.has(wake.workspaceId) || stillQueued(wake.workspaceId, orchestrator)) {
			arm(wake);
			return;
		}
		pending.delete(wake.workspaceId);
		sending.add(wake.workspaceId);
		try {
			const sessionIds = [...wake.sessionIds].filter((id) => id !== orchestrator);
			const card = await deps.describe(container, wake.workspaceId, sessionIds, [...wake.reasons]);
			if (!card) return;
			lastSent.set(wake.workspaceId, { sessionId: orchestrator, details: card.details });
			await deps.deliver(container, orchestrator, card);
		} catch (error) {
			log.warn(`the orchestrator of container ${container.id} was not woken`, error);
		} finally {
			sending.delete(wake.workspaceId);
		}
	}

	function wake(workspaceId: string, sessionId: string | null, reason: ContainerWakeReason): void {
		const container = deps.containerOf(workspaceId);
		const orchestrator = container?.orchestratorSessionId;
		if (!container || !orchestrator || sessionId === orchestrator) return;
		let gathering = pending.get(workspaceId);
		if (gathering && gathering.containerId !== container.id) {
			if (gathering.timer) clearTimeout(gathering.timer);
			pending.delete(workspaceId);
			gathering = undefined;
		}
		if (!gathering) {
			gathering = {
				containerId: container.id,
				workspaceId,
				sessionIds: new Set(),
				reasons: new Set(),
				timer: null,
			};
			pending.set(workspaceId, gathering);
			arm(gathering);
		}
		if (sessionId) gathering.sessionIds.add(sessionId);
		gathering.reasons.add(reason);
	}

	return {
		seed(workspaces) {
			for (const workspace of workspaces) reviews.set(workspace.id, reviewKey(workspace));
		},
		onSessionEvent(sessionId, workspaceId, event) {
			if (event.type === "agent_settled") wake(workspaceId, sessionId, "chat");
		},
		onSessionState(record) {
			const next = chatState(record.state);
			const previous = chatStates.get(record.sessionId);
			chatStates.set(record.sessionId, next);
			if (previous !== undefined && previous !== next && WAKING_STATES.has(next))
				wake(record.workspaceId, record.sessionId, "chat");
		},
		onWorkspaceEvent(event) {
			if (event.kind === "removed") {
				reviews.delete(event.id);
				return;
			}
			const { workspace } = event;
			const next = reviewKey(workspace);
			const previous = reviews.get(workspace.id);
			reviews.set(workspace.id, next);
			if (event.kind === "updated" && previous !== undefined && previous !== next)
				wake(workspace.id, null, "review");
		},
		busy() {
			return pending.size > 0 || sending.size > 0;
		},
		dispose() {
			for (const gathering of pending.values()) if (gathering.timer) clearTimeout(gathering.timer);
			pending.clear();
			lastSent.clear();
			chatStates.clear();
			reviews.clear();
		},
	};
}

interface WakeChat {
	summary: SessionSummary;
	finalMessage: string | null;
	openTodos: number | null;
}

const WAKE_FOOTER =
	"This is an automatic update from ThinkRail, not a message from the human. Act on it only if it changes what the container needs (message a member's chat, open a PR, tell the human); otherwise acknowledge it in one short line.";

/** The card's text: what changed in the member, each changed chat's state, plan and final message, its PR. */
export function wakeText(input: {
	workspace: Workspace;
	projectName: string;
	reasons: readonly ContainerWakeReason[];
	changed: readonly WakeChat[];
	others: readonly SessionSummary[];
}): string {
	const { workspace } = input;
	const what = [
		...input.changed.map(
			(chat) => `chat ${chatName(chat.summary)} ${chatState(chat.summary.state)}`,
		),
		...(input.reasons.includes("review") ? [`its review is now ${prLine(workspace)}`] : []),
	];
	const lines = [
		`Member update · ${input.projectName} · ${workspace.name} (branch ${workspace.branch}, workspace id ${workspace.id})${what.length > 0 ? `: ${what.join("; ")}` : ""}.`,
		"",
		`- PR: ${prLine(workspace)}`,
	];
	for (const chat of input.changed) {
		const plan = chat.openTodos === null ? "" : ` · ${chat.openTodos} open todo(s)`;
		lines.push(
			`- Chat ${chatName(chat.summary)} (${chat.summary.sessionId}): ${chatState(chat.summary.state)}${plan}`,
		);
	}
	for (const other of input.others) {
		lines.push(`- Chat ${chatName(other)} (${other.sessionId}): ${chatState(other.state)}`);
	}
	for (const chat of input.changed) {
		if (!chat.finalMessage) continue;
		lines.push(
			"",
			`Final message of chat ${chatName(chat.summary)}:`,
			"",
			...clampFinalMessage(chat.finalMessage)
				.split("\n")
				.map((line) => `> ${line}`),
		);
	}
	lines.push("", WAKE_FOOTER);
	return lines.join("\n");
}

function openTodos(workspaceId: string, sessionId: string): number | null {
	try {
		return countOpenTodos({ workspaceId, sessionId });
	} catch {
		return null;
	}
}

async function describeWake(
	container: Container,
	workspaceId: string,
	sessionIds: readonly string[],
	reasons: readonly ContainerWakeReason[],
): Promise<WakeCard | null> {
	const workspace = listAllWorkspaceRecords().find((candidate) => candidate.id === workspaceId);
	if (!workspace) return null;
	const projectName =
		getProjects().find((project) => project.id === workspace.projectId)?.name ??
		workspace.projectId;
	const chats = await listSessions(workspace.id, workspace.worktreePath).catch(
		(): SessionSummary[] => [],
	);
	const wanted = new Set(sessionIds);
	const changed = chats.filter((chat) => wanted.has(chat.sessionId));
	const finals =
		changed.length === 0
			? new Map<string, string | null>()
			: await readFinalAssistantTexts(
					workspace.id,
					workspace.worktreePath,
					changed.map((chat) => chat.sessionId),
				).catch(() => new Map<string, string | null>());
	const text = wakeText({
		workspace,
		projectName,
		reasons,
		changed: changed.map((summary) => ({
			summary,
			finalMessage: finals.get(summary.sessionId) ?? null,
			openTodos: openTodos(workspace.id, summary.sessionId),
		})),
		others: chats.filter((chat) => !wanted.has(chat.sessionId)),
	});
	return {
		text,
		details: {
			containerId: container.id,
			workspaceId,
			workspaceName: workspace.name,
			reasons: [...reasons],
		},
	};
}

async function deliverWake(container: Container, sessionId: string, card: WakeCard) {
	const chat = orchestratorChat(container.id);
	if (!chat) return;
	const attached =
		getSessionWorkspaceId(sessionId) === chat.id ||
		(getSessionWorkspaceId(sessionId) === undefined &&
			(await ensureSessionAttached(sessionId, chat.id, chat.worktreePath)));
	if (!attached) throw new Error(`the orchestrator session ${sessionId} could not be opened`);
	await ackSend(
		runObservation.send(sessionId, "internal", () =>
			sendHostMessageToSession(sessionId, CONTAINER_WAKE_CUSTOM_TYPE, card.text, card.details),
		),
	);
}

export const liveWakeupDeps: WakeupDeps = {
	containerOf: (workspaceId) =>
		listContainers().find((container) => container.workspaceIds.includes(workspaceId)),
	describe: describeWake,
	deliver: deliverWake,
	isPending: isHostMessagePending,
	windowMs: WAKE_WINDOW_MS,
};
