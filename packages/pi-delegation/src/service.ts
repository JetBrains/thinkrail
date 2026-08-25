// The delegation service — createChild + the run-owning handle. Owns the run loop ONCE for every
// consumer: per-parent pacing (FIFO semaphore), turn caps (steer a wrap-up, then abort), usage
// aggregation, the run registry, and lifecycle events. V1 implements exactly the subagent axis
// combination (hidden, non-interactive, fresh, session options present); everything else rejects
// loudly with a typed `DelegationError` — the seam is real, the dead code is not.

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Semaphore } from "./semaphore";
import { DEFAULT_SCOPE, defaultDelegationRoot, delegationSessionDir } from "./storage";
import {
	type ChildHandle,
	type CreateChildSpec,
	type DelegationBindings,
	DelegationError,
	type DelegationRunDetails,
	type DelegationService,
	type LifecycleEvent,
	type RunLifecycleStatus,
	type RunOptions,
	type RunOutcome,
	type RunSnapshot,
	type RunStatus,
	type SessionOptions,
	type SpawnRecord,
} from "./types";

const DEFAULT_MAX_CONCURRENT_PER_PARENT = 4;

/** The turn-cap wrap-up instruction — steered into the child when `RunOptions.maxTurns` is hit. */
const WRAP_UP_INSTRUCTION =
	"You have reached your turn limit. Stop calling tools now and reply with your final result: " +
	"summarize what you completed, what remains, and any findings.";

interface ChildEntry {
	readonly record: SpawnRecord;
	readonly session: AgentSession;
	readonly listeners: Set<(e: LifecycleEvent) => void>;
	handle?: ChildHandle;
	workspaceDispose?: (outcome: { status: RunStatus }) => { resultAddendum?: string } | undefined;
	snapshot?: RunSnapshot;
	disposed: boolean;
}

/**
 * Reject every axis combination V1 has no consumer for — before any resource is touched — and
 * return the validated `SessionOptions` (present by construction after the checks).
 */
function assertV1Combination(spec: CreateChildSpec): SessionOptions {
	if (spec.visibility === "hidden" && spec.interactive === true) {
		throw new DelegationError(
			"invalid-combination",
			"hidden + interactive is permanently invalid: an interactive child must be listed so a human can reach it",
		);
	}
	if (spec.visibility === "listed") {
		throw new DelegationError(
			"not-implemented",
			'visibility "listed" has no V1 consumer (subsessions/branching land later); use "hidden"',
		);
	}
	if (spec.interactive === true) {
		throw new DelegationError(
			"not-implemented",
			"interactive children have no V1 consumer (subsessions land later)",
		);
	}
	const originKind = spec.origin?.kind ?? "fresh";
	if (originKind !== "fresh") {
		throw new DelegationError(
			"not-implemented",
			`origin "${originKind}" has no V1 consumer (branching/seeding land later); use "fresh"`,
		);
	}
	if (!spec.session) {
		throw new DelegationError(
			"not-implemented",
			"parent-like session options (absent `session`) have no V1 consumer — pass explicit SessionOptions",
		);
	}
	if (spec.workspace) {
		// The seam's sequencing (prepare needs the child id, which exists only after creation) is
		// pinned by its first consumer (the ThinkRail worktree provider) — untestable dead code until.
		throw new DelegationError(
			"not-implemented",
			"WorkspaceProvider has no V1 consumer — children share the parent cwd",
		);
	}
	return spec.session;
}

/** The last assistant message — terminal status (stopReason) and final text live on it. */
function lastAssistant(session: AgentSession): AssistantMessage | undefined {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const message = session.messages[i];
		if (message?.role === "assistant") return message as AssistantMessage;
	}
	return undefined;
}

function textOf(message: AssistantMessage | undefined): string | undefined {
	if (!message) return undefined;
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
	return text.length > 0 ? text : undefined;
}

export function createDelegationService(bindings: DelegationBindings): DelegationService {
	const delegationRoot = bindings.delegationRoot ?? defaultDelegationRoot();
	const scope = bindings.scope ?? DEFAULT_SCOPE;
	const slotsPerParent = bindings.maxConcurrentPerParent ?? DEFAULT_MAX_CONCURRENT_PER_PARENT;

	const children = new Map<string, ChildEntry>();
	const byParent = new Map<string, Set<string>>();
	const semaphores = new Map<string, Semaphore>();
	const lifecycleListeners = new Set<(e: LifecycleEvent) => void>();

	// One model/auth runtime per service — the embedder's shared one, else pi's own, built lazily.
	let runtimePromise: Promise<ModelRuntime> | undefined;
	function getRuntime(): Promise<ModelRuntime> {
		runtimePromise ??= bindings.modelRuntime
			? Promise.resolve(bindings.modelRuntime)
			: ModelRuntime.create();
		return runtimePromise;
	}

	function semaphoreFor(parentSessionId: string): Semaphore {
		let semaphore = semaphores.get(parentSessionId);
		if (!semaphore) {
			semaphore = new Semaphore(slotsPerParent);
			semaphores.set(parentSessionId, semaphore);
		}
		return semaphore;
	}

	function emit(event: LifecycleEvent, entry: ChildEntry): void {
		for (const listener of lifecycleListeners) listener(event);
		for (const listener of entry.listeners) listener(event);
	}

	function buildDetails(
		entry: ChildEntry,
		task: string,
		status: RunLifecycleStatus,
		turns: number,
		activity: string | undefined,
		startedAt: number,
	): DelegationRunDetails {
		const { session, record } = entry;
		const stats = session.getSessionStats();
		const contextUsage = stats.contextUsage ?? session.getContextUsage();
		return {
			childSessionId: record.sessionId,
			...(record.info.roleName !== undefined ? { roleName: record.info.roleName } : {}),
			...(record.info.roleSource !== undefined ? { roleSource: record.info.roleSource } : {}),
			task,
			status,
			...(session.model ? { model: `${session.model.provider}/${session.model.id}` } : {}),
			usage: {
				input: stats.tokens.input,
				output: stats.tokens.output,
				cacheRead: stats.tokens.cacheRead,
				cacheWrite: stats.tokens.cacheWrite,
				cost: stats.cost,
				turns,
				contextTokens: contextUsage?.tokens ?? 0,
			},
			durationMs: Date.now() - startedAt,
			...(activity !== undefined ? { activity } : {}),
		};
	}

	/** One run: prompt the child, track turns/activity/usage, enforce the turn cap, honor the signal. */
	async function driveRun(entry: ChildEntry, task: string, opts: RunOptions): Promise<RunOutcome> {
		const { session } = entry;
		const startedAt = Date.now();
		const cap = opts.maxTurns;
		let turns = 0;
		let activity: string | undefined;
		let capSteered = false;
		let abortRequested = false;

		const pushUpdate = (status: RunLifecycleStatus) => {
			const details = buildDetails(entry, task, status, turns, activity, startedAt);
			if (entry.snapshot?.task === task) entry.snapshot = { ...entry.snapshot, status, details };
			opts.onUpdate?.(details);
		};

		const unsubscribe = session.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				activity = event.toolName;
				pushUpdate("running");
			} else if (event.type === "turn_end") {
				turns++;
				// Steer the wrap-up only when the run will actually CONTINUE (the ending turn issued
				// tool calls) — a child that finished naturally at the cap must keep its real answer,
				// not be dragged into a spurious extra turn (pi drains steering before deciding to stop).
				const continues =
					event.message.role === "assistant" &&
					event.message.content.some((block) => block.type === "toolCall");
				if (cap !== undefined && turns >= cap && continues && !capSteered) {
					capSteered = true;
					void session.steer(WRAP_UP_INSTRUCTION).catch(() => {});
				}
				pushUpdate("running");
			} else if (event.type === "turn_start") {
				// The wrap-up turn (cap+1) is allowed to finish; a turn starting beyond it is cut off.
				if (cap !== undefined && turns > cap) {
					abortRequested = true;
					void session.abort().catch(() => {});
				}
			}
		});

		const onAbort = () => {
			abortRequested = true;
			void session.abort().catch(() => {});
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });

		let thrownMessage: string | undefined;
		try {
			await session.prompt(task);
		} catch (error) {
			thrownMessage = error instanceof Error ? error.message : String(error);
		} finally {
			unsubscribe();
			opts.signal?.removeEventListener("abort", onAbort);
			// Anything still queued after the prompt settles (an undelivered wrap-up steer on an
			// errored/aborted turn) is stale by definition — it must not leak into the next run.
			session.clearQueue();
		}

		const last = lastAssistant(session);
		let status: RunStatus;
		let errorMessage = thrownMessage;
		if (abortRequested || last?.stopReason === "aborted") {
			status = "aborted";
		} else if (thrownMessage !== undefined || last?.stopReason === "error") {
			status = "error";
			errorMessage ??= last?.errorMessage;
		} else {
			status = "completed";
		}
		const finalText = textOf(last);
		const details = buildDetails(entry, task, status, turns, activity, startedAt);
		return {
			status,
			...(finalText !== undefined ? { finalText } : {}),
			details,
			...(errorMessage !== undefined ? { errorMessage } : {}),
		};
	}

	async function runQueued(entry: ChildEntry, task: string, opts: RunOptions): Promise<RunOutcome> {
		if (entry.disposed) {
			throw new DelegationError("disposed", `Child ${entry.record.sessionId} is disposed`);
		}
		const current = entry.snapshot;
		if (current && (current.status === "queued" || current.status === "running")) {
			throw new DelegationError(
				"already-running",
				`Child ${entry.record.sessionId} already has a run in flight — steer() it instead`,
			);
		}
		const startedAt = Date.now();
		entry.snapshot = {
			status: "queued",
			task,
			details: buildDetails(entry, task, "queued", 0, undefined, startedAt),
			collected: false,
		};
		emit(
			{
				type: "run-queued",
				sessionId: entry.record.sessionId,
				parentSessionId: entry.record.parentSessionId,
			},
			entry,
		);
		const release = await semaphoreFor(entry.record.parentSessionId).acquire();
		try {
			let outcome: RunOutcome;
			if (entry.disposed || opts.signal?.aborted) {
				outcome = {
					status: "aborted",
					details: buildDetails(entry, task, "aborted", 0, undefined, startedAt),
					errorMessage: entry.disposed ? "disposed before start" : "aborted before start",
				};
			} else {
				entry.snapshot = { ...entry.snapshot, status: "running" };
				emit(
					{
						type: "run-started",
						sessionId: entry.record.sessionId,
						parentSessionId: entry.record.parentSessionId,
					},
					entry,
				);
				outcome = await driveRun(entry, task, opts);
			}
			entry.snapshot = {
				status: outcome.status,
				task,
				details: outcome.details,
				...(outcome.finalText !== undefined ? { finalText: outcome.finalText } : {}),
				collected: false,
			};
			emit(
				{
					type: "run-terminal",
					sessionId: entry.record.sessionId,
					parentSessionId: entry.record.parentSessionId,
					outcome,
				},
				entry,
			);
			return outcome;
		} finally {
			release();
		}
	}

	async function disposeChild(entry: ChildEntry): Promise<void> {
		if (entry.disposed) return;
		entry.disposed = true;
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		const lastStatus = entry.snapshot?.status;
		const terminal: RunStatus =
			lastStatus === "completed" || lastStatus === "error" ? lastStatus : "aborted";
		const teardown = entry.workspaceDispose?.({ status: terminal });
		if (teardown?.resultAddendum && entry.snapshot) {
			const finalText = [entry.snapshot.finalText, teardown.resultAddendum]
				.filter((part): part is string => part !== undefined)
				.join("\n\n");
			entry.snapshot = { ...entry.snapshot, finalText };
		}
		entry.session.dispose();
		children.delete(entry.record.sessionId);
		byParent.get(entry.record.parentSessionId)?.delete(entry.record.sessionId);
		emit(
			{
				type: "child-disposed",
				sessionId: entry.record.sessionId,
				parentSessionId: entry.record.parentSessionId,
			},
			entry,
		);
	}

	function makeHandle(entry: ChildEntry): ChildHandle {
		return {
			get sessionId() {
				return entry.record.sessionId;
			},
			get record() {
				return entry.record;
			},
			get snapshot() {
				return entry.snapshot;
			},
			runQueued: (task, opts = {}) => runQueued(entry, task, opts),
			runNow: () => {
				throw new DelegationError(
					"not-implemented",
					"runNow has no V1 consumer (workflow engines land later) — use runQueued",
				);
			},
			steer: async (text) => {
				if (entry.disposed) {
					throw new DelegationError("disposed", `Child ${entry.record.sessionId} is disposed`);
				}
				await entry.session.steer(text);
			},
			abort: async () => {
				if (entry.disposed) return;
				await entry.session.abort();
			},
			dispose: () => disposeChild(entry),
			onEvent: (listener) => {
				entry.listeners.add(listener);
				return () => entry.listeners.delete(listener);
			},
			collectResult: () => {
				const snapshot = entry.snapshot;
				if (
					snapshot &&
					(snapshot.status === "completed" ||
						snapshot.status === "error" ||
						snapshot.status === "aborted")
				) {
					entry.snapshot = { ...snapshot, collected: true };
					return entry.snapshot;
				}
				return snapshot;
			},
		};
	}

	async function createChild(spec: CreateChildSpec): Promise<ChildHandle> {
		const options = assertV1Combination(spec);
		const parent = bindings.resolveParent(spec.parent);
		if (!parent) {
			throw new DelegationError(
				"unknown-parent",
				`Parent session ${spec.parent} is not live — children derive their defaults from a live parent`,
			);
		}
		const runtime = await getRuntime();
		const model = options.model
			? runtime.getModel(options.model.provider, options.model.id)
			: parent.model;
		if (options.model && !model) {
			throw new Error(
				`Unknown model ${options.model.provider}/${options.model.id} — resolve against available models before createChild`,
			);
		}
		const thinkingLevel = options.thinkingLevel ?? parent.thinkingLevel;
		const cwd = parent.sessionManager.getCwd();

		const settingsManager = SettingsManager.create(cwd);
		const skills = options.skills ?? [];
		const systemPrompt = options.systemPrompt;
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: getAgentDir(),
			settingsManager,
			// Narrow by default (decision 7 of the subagent spec): no extensions, prompts, or themes in
			// a V1 child; context files and skills are explicit opt-ins in `SessionOptions`.
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			...(options.contextFiles === true ? {} : { noContextFiles: true }),
			...(systemPrompt !== undefined ? { systemPromptOverride: () => systemPrompt } : {}),
			skillsOverride: (current) => ({
				skills: current.skills.filter((skill) => skills.includes(skill.name)),
				diagnostics: current.diagnostics,
			}),
		});
		await resourceLoader.reload();

		const sessionDir = delegationSessionDir(delegationRoot, scope, spec.parent);
		const { session } = await createAgentSession({
			cwd,
			modelRuntime: runtime,
			sessionManager: SessionManager.create(cwd, sessionDir),
			settingsManager,
			resourceLoader,
			...(model ? { model } : {}),
			...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
			...(options.tools !== undefined ? { tools: options.tools } : {}),
			...(options.excludeTools !== undefined ? { excludeTools: options.excludeTools } : {}),
		});

		const record: SpawnRecord = {
			sessionId: session.sessionId,
			parentSessionId: spec.parent,
			scope,
			originKind: "fresh",
			info: spec.info,
			interactive: false,
			visibility: "hidden",
			createdAt: new Date().toISOString(),
			sessionFile: session.sessionManager.getSessionFile() ?? "",
		};
		const entry: ChildEntry = {
			record,
			session,
			listeners: new Set(),
			disposed: false,
		};
		const handle = makeHandle(entry);
		entry.handle = handle;

		children.set(record.sessionId, entry);
		let siblings = byParent.get(spec.parent);
		if (!siblings) {
			siblings = new Set();
			byParent.set(spec.parent, siblings);
		}
		siblings.add(record.sessionId);
		emit({ type: "child-created", record }, entry);
		return handle;
	}

	return {
		createChild,
		findChild: (sessionId) => children.get(sessionId)?.handle,
		childrenOf: (parentSessionId) => {
			const ids = byParent.get(parentSessionId);
			if (!ids) return [];
			const handles: ChildHandle[] = [];
			for (const id of ids) {
				const handle = children.get(id)?.handle;
				if (handle) handles.push(handle);
			}
			return handles;
		},
		onLifecycle: (listener) => {
			lifecycleListeners.add(listener);
			return () => lifecycleListeners.delete(listener);
		},
		disposeChildrenOf: async (parentSessionId) => {
			const ids = [...(byParent.get(parentSessionId) ?? [])];
			for (const id of ids) {
				const entry = children.get(id);
				if (entry) await disposeChild(entry);
			}
			byParent.delete(parentSessionId);
			semaphores.delete(parentSessionId);
		},
	};
}
