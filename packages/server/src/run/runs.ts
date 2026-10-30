import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
	ProjectRun,
	RunExecution,
	RunRecipe,
	RunRecipeAuthor,
	RunRecipeDocument,
	RunSettings,
	RunTarget,
	RunWorkspaceState,
} from "@thinkrail/contracts";
import { COMMAND_TAB_KEY_PREFIX, DEFAULT_RUN_SETTINGS } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { isPortFree } from "@thinkrail/shared/freePort";
import { describeError, logger } from "../log";
import {
	dataDir,
	loadRun,
	type PersistedLastRun,
	type PersistedRun,
	saveRun,
} from "../persistence";
import { getProjects } from "../projects";
import {
	type CommandTabEnd,
	onCommandTabEnded,
	readTerminalRecording,
	startCommandTab,
	stopCommandTab,
} from "../terminal";
import { getWorkspace, listWorkspaceRecords } from "../workspaces";
import { allocatePorts, createSerialQueue } from "./ports";
import { assertRecipe, validateRecipe } from "./recipe";
import { composeRunScript, discoverLoopbackUrl, resolveUrl, stripAnsi, urlPort } from "./script";

const log = logger("run");

export const PREPARE_TAB_KEY = `${COMMAND_TAB_KEY_PREFIX}-prepare`;
export const RUN_OUTPUT_TAIL_CHARS = 64 * 1024;
const POLL_MS = 500;
const TEARDOWN_WAIT_MS = 10_000;

export function runTabKey(targetId: string | null): string {
	return targetId === null ? PREPARE_TAB_KEY : `${COMMAND_TAB_KEY_PREFIX}:${targetId}`;
}

export function targetIdOfTabKey(tabKey: string): string | null | undefined {
	if (tabKey === PREPARE_TAB_KEY) return null;
	const prefix = `${COMMAND_TAB_KEY_PREFIX}:`;
	return tabKey.startsWith(prefix) ? tabKey.slice(prefix.length) : undefined;
}

export interface RunPublisher {
	recipe(projectId: string, run: ProjectRun): void;
	state(state: RunWorkspaceState): void;
}

interface EndedRecord {
	execution: RunExecution;
	tail: string | null;
}

interface Slot {
	workspaceId: string;
	execution: RunExecution;
	target: RunTarget | null;
	stopRequested: boolean;
	cancelled: boolean;
	spawned: boolean;
	settled: boolean;
	boundVariables: string[];
	boundPorts: number[];
	sentinel: string | null;
	tail: string | null;
	previous: EndedRecord | null;
	pollTimer: ReturnType<typeof setTimeout> | null;
	prepareDone: () => void;
	endWaiters: Array<(execution: RunExecution) => void>;
}

const LIVE: ReadonlySet<RunExecution["status"]> = new Set([
	"starting",
	"running",
	"listening",
	"stopping",
]);

let publisher: RunPublisher | null = null;
export function setRunPublisher(next: RunPublisher | null): void {
	publisher = next;
}

let store: PersistedRun | null = null;
const slots = new Map<string, Map<string, Slot>>();
const closedWorkspaces = new Set<string>();
const allocation = createSerialQueue();
const prepareQueues = new Map<string, ReturnType<typeof createSerialQueue>>();
let unsubscribeEnded: (() => void) | null = null;

function slotKey(targetId: string | null): string {
	return targetId ?? "";
}

function isLive(slot: Slot): boolean {
	return LIVE.has(slot.execution.status);
}

function snapshot(execution: RunExecution): RunExecution {
	return { ...execution, ports: { ...execution.ports } };
}

function workspaceSlots(workspaceId: string): Map<string, Slot> {
	let map = slots.get(workspaceId);
	if (!map) {
		map = new Map();
		slots.set(workspaceId, map);
	}
	return map;
}

function sentinelDir(): string {
	return join(dataDir(), "run-sentinels");
}

function state(): PersistedRun {
	if (store) return store;
	store = loadRun();
	reviveLastRuns(store);
	unsubscribeEnded ??= onCommandTabEnded(handleCommandTabEnd);
	return store;
}

function persist(): void {
	if (store) saveRun(store);
}

function endedSlot(workspaceId: string, last: PersistedLastRun): Slot {
	const execution: RunExecution = {
		runId: last.runId,
		targetId: last.targetId,
		tabKey: runTabKey(last.targetId),
		status: last.status === "stopped" ? "stopped" : "exited",
		startedAt: last.startedAt,
		endedAt: last.endedAt ?? Date.now(),
		exitCode: last.status === "interrupted" ? null : last.exitCode,
		ports: {},
		origin: "user",
	};
	return {
		workspaceId,
		execution,
		target: null,
		stopRequested: false,
		cancelled: false,
		spawned: false,
		settled: true,
		boundVariables: [],
		boundPorts: [],
		sentinel: null,
		tail: null,
		previous: null,
		pollTimer: null,
		prepareDone: () => {},
		endWaiters: [],
	};
}

/** A host restart finds no live run; whatever was interrupted is "ended, outcome unknown". */
function reviveLastRuns(loaded: PersistedRun): void {
	let changed = false;
	for (const [workspaceId, byTarget] of Object.entries(loaded.lastRuns)) {
		for (const [key, last] of Object.entries(byTarget)) {
			if (last.status === "interrupted" || last.endedAt === null) {
				byTarget[key] = { ...last, status: "interrupted", endedAt: Date.now(), exitCode: null };
				changed = true;
			}
			workspaceSlots(workspaceId).set(
				key,
				endedSlot(workspaceId, byTarget[key] as PersistedLastRun),
			);
		}
	}
	if (changed) saveRun(loaded);
}

function documentOf(projectId: string): RunRecipeDocument | null {
	const stored = state().projects[projectId]?.document;
	if (!stored) return null;
	const validation = validateRecipe(stored.recipe);
	if (!validation.ok) {
		log.warn("stored recipe is invalid and is ignored", { projectId });
		return null;
	}
	return {
		recipe: validation.recipe,
		revision: stored.revision,
		learnedAt: stored.learnedAt,
		learnedBy: stored.learnedBy,
	};
}

function settingsOf(projectId: string): RunSettings {
	return state().projects[projectId]?.settings ?? { ...DEFAULT_RUN_SETTINGS };
}

export function getProjectRun(projectId: string): ProjectRun {
	const ports: Record<string, Record<string, number>> = {};
	for (const ws of listWorkspaceRecords(projectId)) {
		const leased = state().ports[ws.id];
		if (leased) ports[ws.id] = { ...leased };
	}
	return { document: documentOf(projectId), settings: settingsOf(projectId), ports };
}

function publishRecipe(projectId: string): void {
	publisher?.recipe(projectId, getProjectRun(projectId));
}

function publishState(workspaceId: string): void {
	publisher?.state(listRunState(workspaceId));
}

function writeDocument(
	projectId: string,
	recipe: RunRecipe,
	learnedBy: RunRecipeAuthor,
): RunRecipeDocument {
	const current = state().projects[projectId];
	const revision = (current?.document?.revision ?? 0) + 1;
	const document: RunRecipeDocument = { recipe, revision, learnedAt: Date.now(), learnedBy };
	state().projects[projectId] = {
		document: { recipe, revision, learnedAt: document.learnedAt, learnedBy },
		settings: current?.settings ?? { ...DEFAULT_RUN_SETTINGS },
	};
	persist();
	publishRecipe(projectId);
	return document;
}

function assertRevision(projectId: string, expectedRevision: number): void {
	const current = state().projects[projectId]?.document?.revision ?? 0;
	if (expectedRevision !== current) {
		throw new CodedError(
			"RUN_RECIPE_CONFLICT",
			`The recipe changed meanwhile (revision ${current}, expected ${expectedRevision})`,
		);
	}
}

export function setRecipe(
	projectId: string,
	value: unknown,
	expectedRevision: number,
	learnedBy: RunRecipeAuthor,
): RunRecipeDocument {
	const recipe = assertRecipe(value);
	assertRevision(projectId, expectedRevision);
	return writeDocument(projectId, recipe, learnedBy);
}

export function setPrimaryTarget(
	projectId: string,
	targetId: string,
	expectedRevision: number,
): RunRecipeDocument {
	const document = documentOf(projectId);
	if (!document) throw new CodedError("RUN_RECIPE_MISSING", "This project has no run recipe yet");
	if (!document.recipe.targets.some((target) => target.id === targetId)) {
		throw new CodedError("RUN_TARGET_UNKNOWN", `No target '${targetId}' in the recipe`);
	}
	assertRevision(projectId, expectedRevision);
	return writeDocument(projectId, { ...document.recipe, primary: targetId }, "user");
}

export function setRunSettings(projectId: string, patch: Partial<RunSettings>): RunSettings {
	const current = state().projects[projectId];
	const settings: RunSettings = { ...settingsOf(projectId), ...patch };
	state().projects[projectId] = { document: current?.document ?? null, settings };
	persist();
	publishRecipe(projectId);
	return settings;
}

export function listRunState(workspaceId: string): RunWorkspaceState {
	state();
	const executions = [...(slots.get(workspaceId)?.values() ?? [])].map((slot) =>
		snapshot(slot.execution),
	);
	return { workspaceId, executions };
}

function liveSlotsOf(workspaceId: string): Slot[] {
	return [...(slots.get(workspaceId)?.values() ?? [])].filter(isLive);
}

function takenPorts(workspaceId: string, projectId: string): Set<number> {
	const taken = new Set<number>();
	for (const [otherWorkspace, map] of slots) {
		if (otherWorkspace === workspaceId) continue;
		for (const slot of map.values()) {
			if (isLive(slot)) for (const port of slot.boundPorts) taken.add(port);
		}
	}
	for (const sibling of listWorkspaceRecords(projectId)) {
		if (sibling.id === workspaceId) continue;
		for (const port of Object.values(state().ports[sibling.id] ?? {})) taken.add(port);
	}
	return taken;
}

function prepareQueue(workspaceId: string): ReturnType<typeof createSerialQueue> {
	let queue = prepareQueues.get(workspaceId);
	if (!queue) {
		queue = createSerialQueue();
		prepareQueues.set(workspaceId, queue);
	}
	return queue;
}

function persistLastRun(slot: Slot): void {
	const lastRuns = state().lastRuns;
	const byTarget = lastRuns[slot.workspaceId] ?? {};
	lastRuns[slot.workspaceId] = byTarget;
	const { execution } = slot;
	const status: PersistedLastRun["status"] = !slot.settled
		? "interrupted"
		: execution.status === "stopped"
			? "stopped"
			: "exited";
	byTarget[slotKey(execution.targetId)] = {
		runId: execution.runId,
		targetId: execution.targetId,
		startedAt: execution.startedAt,
		endedAt: execution.endedAt ?? null,
		status,
		exitCode: execution.exitCode ?? null,
	};
	persist();
}

function assertStillOwned(slot: Slot): void {
	if (slot.cancelled)
		throw new CodedError("RUN_NOT_RUNNING", "The run was stopped before it started");
	if (closedWorkspaces.has(slot.workspaceId)) {
		throw new Error(`Workspace ${slot.workspaceId} was removed`);
	}
	if (slots.get(slot.workspaceId)?.get(slotKey(slot.execution.targetId)) !== slot) {
		throw new CodedError("RUN_NOT_RUNNING", "The run was replaced");
	}
}

function clearPoll(slot: Slot): void {
	if (slot.pollTimer) clearTimeout(slot.pollTimer);
	slot.pollTimer = null;
}

function removeSentinel(slot: Slot): void {
	if (!slot.sentinel) return;
	rmSync(slot.sentinel, { force: true });
	slot.sentinel = null;
}

function settle(slot: Slot, outcome: { stopped: boolean; exitCode: number | null }): void {
	if (slot.settled) return;
	slot.settled = true;
	clearPoll(slot);
	const { execution } = slot;
	execution.status = outcome.stopped ? "stopped" : "exited";
	execution.exitCode = outcome.exitCode;
	execution.endedAt = Date.now();
	if (slot.spawned) {
		const recording = readTerminalRecording(
			slot.workspaceId,
			execution.tabKey,
			RUN_OUTPUT_TAIL_CHARS * 2,
		);
		slot.tail = recording ? stripAnsi(recording).slice(-RUN_OUTPUT_TAIL_CHARS) : null;
	}
	slot.boundPorts = [];
	slot.boundVariables = [];
	removeSentinel(slot);
	slot.prepareDone();
	persistLastRun(slot);
	publishState(slot.workspaceId);
	for (const waiter of slot.endWaiters) waiter(snapshot(execution));
	slot.endWaiters = [];
}

function handleCommandTabEnd(end: CommandTabEnd): void {
	const targetId = targetIdOfTabKey(end.tabKey);
	if (targetId === undefined) return;
	const slot = slots.get(end.workspaceId)?.get(slotKey(targetId));
	if (!slot || !isLive(slot) || !slot.spawned) return;
	settle(slot, {
		stopped: slot.stopRequested || end.reason !== "exit",
		exitCode: end.reason === "exit" ? end.exitCode : null,
	});
}

function markPrepared(slot: Slot): void {
	removeSentinel(slot);
	if (slot.execution.status === "starting") {
		slot.execution.status = "running";
		publishState(slot.workspaceId);
	}
	slot.prepareDone();
}

function schedulePoll(slot: Slot): void {
	clearPoll(slot);
	slot.pollTimer = setTimeout(() => {
		slot.pollTimer = null;
		void poll(slot);
	}, POLL_MS);
}

async function poll(slot: Slot): Promise<void> {
	if (slot.settled) return;
	if (slot.sentinel && existsSync(slot.sentinel)) markPrepared(slot);
	const { execution } = slot;
	if (slot.target?.kind === "serve" && execution.status === "running") {
		if (!execution.url) {
			const recording = readTerminalRecording(
				slot.workspaceId,
				execution.tabKey,
				RUN_OUTPUT_TAIL_CHARS,
			);
			const discovered = recording ? discoverLoopbackUrl(recording) : null;
			if (discovered) {
				execution.url = discovered;
				publishState(slot.workspaceId);
			}
		}
		const port = execution.url ? urlPort(execution.url) : null;
		if (port !== null) {
			const listening = !(await isPortFree(port));
			if (slot.settled) return;
			if (listening) {
				execution.status = "listening";
				publishState(slot.workspaceId);
			}
		}
	}
	const stillPolling =
		Boolean(slot.sentinel) || (slot.target?.kind === "serve" && execution.status === "running");
	if (stillPolling && !slot.settled) schedulePoll(slot);
}

function runEnvironment(
	slot: Slot,
	projectPath: string,
	workspaceName: string,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, port] of Object.entries(slot.execution.ports)) env[name] = String(port);
	env.THINKRAIL_RUN_DEFAULT_WORKTREE = projectPath;
	env.THINKRAIL_RUN_WORKSPACE = workspaceName;
	env.THINKRAIL_RUN_TARGET = slot.execution.targetId ?? "prepare";
	env.THINKRAIL_RUN_ID = slot.execution.runId;
	return env;
}

export interface StartRunOptions {
	prepare?: boolean;
	origin: RunExecution["origin"];
}

export async function startRun(
	workspaceId: string,
	targetId: string | null,
	options: StartRunOptions,
): Promise<RunExecution> {
	if (process.platform === "win32") {
		throw new CodedError(
			"RUN_UNSUPPORTED_PLATFORM",
			"Project runs are not available on Windows yet",
		);
	}
	if (closedWorkspaces.has(workspaceId)) throw new Error(`Workspace ${workspaceId} was removed`);
	const ws = getWorkspace(workspaceId);
	const project = getProjects().find((candidate) => candidate.id === ws.projectId);
	if (!project) throw new Error(`Unknown project: ${ws.projectId}`);
	const document = documentOf(ws.projectId);
	if (!document) throw new CodedError("RUN_RECIPE_MISSING", "This project has no run recipe yet");
	const { recipe } = document;
	const target =
		targetId === null ? null : recipe.targets.find((candidate) => candidate.id === targetId);
	if (target === undefined) {
		throw new CodedError("RUN_TARGET_UNKNOWN", `No target '${targetId}' in the recipe`);
	}
	const key = slotKey(targetId);
	const map = workspaceSlots(workspaceId);
	const existing = map.get(key);
	if (existing && isLive(existing)) {
		throw new CodedError("RUN_ALREADY_RUNNING", `'${targetId ?? "prepare"}' is already running`);
	}
	const boundVariables = target?.kind === "serve" ? (target.ports ?? []) : [];
	for (const live of liveSlotsOf(workspaceId)) {
		const clash = boundVariables.find((name) => live.boundVariables.includes(name));
		if (clash) {
			throw new CodedError(
				"RUN_PORT_IN_USE",
				`'${live.execution.targetId}' already binds ${clash} in this workspace`,
			);
		}
	}

	const runId = randomUUID();
	let resolvePrepared: () => void = () => {};
	const prepared = new Promise<void>((resolve) => {
		resolvePrepared = resolve;
	});
	const slot: Slot = {
		workspaceId,
		execution: {
			runId,
			targetId,
			tabKey: runTabKey(targetId),
			status: "starting",
			startedAt: Date.now(),
			ports: {},
			origin: options.origin,
		},
		target,
		stopRequested: false,
		cancelled: false,
		spawned: false,
		settled: false,
		boundVariables,
		boundPorts: [],
		sentinel: null,
		tail: null,
		previous: existing ? { execution: snapshot(existing.execution), tail: existing.tail } : null,
		pollTimer: null,
		prepareDone: () => resolvePrepared(),
		endWaiters: [],
	};
	map.set(key, slot);
	persistLastRun(slot);
	publishState(workspaceId);

	try {
		const ports = await allocation(async () => {
			assertStillOwned(slot);
			const leased = await allocatePorts({
				natural: recipe.ports,
				current: state().ports[workspaceId] ?? {},
				isDefaultWorkspace: ws.kind === "default",
				workspaceLive: liveSlotsOf(workspaceId).some((live) => live !== slot && live.spawned),
				taken: takenPorts(workspaceId, ws.projectId),
				isFree: (port) => isPortFree(port),
			});
			assertStillOwned(slot);
			slot.execution.ports = leased;
			slot.boundPorts = boundVariables.map((name) => leased[name] ?? 0).filter((port) => port > 0);
			// Persisted inside the chain, so the next allocation already sees this workspace's assignments.
			const previous = state().ports[workspaceId];
			if (
				Object.keys(leased).length > 0 &&
				JSON.stringify(previous ?? {}) !== JSON.stringify(leased)
			) {
				state().ports[workspaceId] = { ...leased };
				persist();
				publishRecipe(ws.projectId);
			}
			return leased;
		});
		if (target?.url) slot.execution.url = resolveUrl(target.url, ports);

		mkdirSync(sentinelDir(), { recursive: true });
		slot.sentinel = join(sentinelDir(), runId);
		const script = composeRunScript({
			prepare: options.prepare === false ? [] : recipe.prepare,
			...(target
				? { target: { command: target.command, ...(target.cwd ? { cwd: target.cwd } : {}) } }
				: {}),
			preparedSentinel: slot.sentinel,
		});
		const title = target ? `Run: ${target.title ?? target.id}` : "Prepare";
		const env = runEnvironment(slot, project.path, ws.name);

		await new Promise<void>((resolve, reject) => {
			void prepareQueue(workspaceId)(async () => {
				try {
					assertStillOwned(slot);
					startCommandTab(workspaceId, slot.execution.tabKey, title, { script, env });
				} catch (error) {
					reject(
						error instanceof CodedError
							? error
							: new CodedError("RUN_SPAWN_FAILED", describeError(error)),
					);
					return;
				}
				slot.spawned = true;
				publishState(workspaceId);
				schedulePoll(slot);
				resolve();
				await prepared;
			});
		});
		return snapshot(slot.execution);
	} catch (error) {
		if (!slot.settled) {
			settle(slot, { stopped: slot.cancelled || slot.stopRequested, exitCode: null });
		}
		throw error;
	}
}

export function stopRun(
	workspaceId: string,
	targetId: string | null,
	options: { force?: boolean } = {},
): RunExecution {
	state();
	const slot = slots.get(workspaceId)?.get(slotKey(targetId));
	if (!slot || !isLive(slot)) {
		throw new CodedError("RUN_NOT_RUNNING", `'${targetId ?? "prepare"}' is not running`);
	}
	slot.stopRequested = true;
	if (!slot.spawned) {
		slot.cancelled = true;
		return snapshot(slot.execution);
	}
	if (slot.execution.status !== "stopping") {
		slot.execution.status = "stopping";
		publishState(workspaceId);
	}
	stopCommandTab(workspaceId, slot.execution.tabKey, { force: options.force ?? false });
	return snapshot(slot.execution);
}

function awaitEnd(slot: Slot): Promise<RunExecution> {
	if (slot.settled) return Promise.resolve(snapshot(slot.execution));
	return new Promise((resolve) => slot.endWaiters.push(resolve));
}

export async function restartRun(
	workspaceId: string,
	targetId: string | null,
	options: StartRunOptions,
): Promise<RunExecution> {
	state();
	const slot = slots.get(workspaceId)?.get(slotKey(targetId));
	if (slot && isLive(slot)) {
		stopRun(workspaceId, targetId);
		await awaitEnd(slot);
	}
	return startRun(workspaceId, targetId, options);
}

export function readRunOutput(
	workspaceId: string,
	targetId: string | null,
	runId: string | undefined,
	maxChars: number,
): { runId: string; text: string } | null {
	state();
	const slot = slots.get(workspaceId)?.get(slotKey(targetId));
	if (!slot) return null;
	const record =
		runId === undefined || runId === slot.execution.runId
			? slot
			: slot.previous?.execution.runId === runId
				? slot.previous
				: null;
	if (!record) return null;
	if (record === slot && isLive(slot) && slot.spawned) {
		const recording = readTerminalRecording(workspaceId, slot.execution.tabKey, maxChars * 2);
		return {
			runId: slot.execution.runId,
			text: recording ? stripAnsi(recording).slice(-maxChars) : "",
		};
	}
	return { runId: record.execution.runId, text: (record.tail ?? "").slice(-maxChars) };
}

/** Stop everything live in a workspace; with `force`, admission closes too (removal), and the promise resolves once the terminal reported every end. */
export async function stopWorkspaceRuns(
	workspaceId: string,
	options: { force?: boolean } = {},
): Promise<void> {
	state();
	if (options.force) closedWorkspaces.add(workspaceId);
	const live = liveSlotsOf(workspaceId);
	const ends = live.map((slot) => {
		slot.stopRequested = true;
		if (!slot.spawned) {
			slot.cancelled = true;
			return awaitEnd(slot);
		}
		if (slot.execution.status !== "stopping") slot.execution.status = "stopping";
		stopCommandTab(workspaceId, slot.execution.tabKey, { force: options.force ?? false });
		return awaitEnd(slot);
	});
	if (ends.length > 0) publishState(workspaceId);
	await Promise.race([Promise.all(ends), Bun.sleep(TEARDOWN_WAIT_MS)]);
}

export async function stopAllRuns(): Promise<void> {
	await Promise.all(
		[...slots.keys()].map((workspaceId) => stopWorkspaceRuns(workspaceId, { force: true })),
	);
}

export function forgetWorkspaceRuns(workspaceId: string): void {
	state();
	slots.delete(workspaceId);
	prepareQueues.delete(workspaceId);
	let changed = false;
	if (state().ports[workspaceId]) {
		delete state().ports[workspaceId];
		changed = true;
	}
	if (state().lastRuns[workspaceId]) {
		delete state().lastRuns[workspaceId];
		changed = true;
	}
	if (changed) persist();
}

/** Test seam: forget everything, including the terminal subscription. */
export function resetRunState(): void {
	for (const map of slots.values()) {
		for (const slot of map.values()) clearPoll(slot);
	}
	slots.clear();
	closedWorkspaces.clear();
	prepareQueues.clear();
	store = null;
	unsubscribeEnded?.();
	unsubscribeEnded = null;
	rmSync(join(dataDir(), "run-sentinels"), { recursive: true, force: true });
}
