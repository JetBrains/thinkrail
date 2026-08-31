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
	type ParentContext,
	type RunLifecycleStatus,
	type RunOptions,
	type RunOutcome,
	type RunSnapshot,
	type RunStatus,
	type SessionOptions,
	type SpawnRecord,
} from "./types";

const DEFAULT_MAX_CONCURRENT_PER_PARENT = 4;

const WRAP_UP_INSTRUCTION =
	"You have reached your turn limit. Stop calling tools now and reply with your final result: " +
	"summarize what you completed, what remains, and any findings.";

interface ActiveRun {
	readonly controller: AbortController;
	readonly settled: Promise<void>;
	readonly resolveSettled: () => void;
	sessionAbort?: Promise<void>;
}

interface ChildEntry {
	readonly record: SpawnRecord;
	readonly session: AgentSession;
	readonly listeners: Set<(e: LifecycleEvent) => void>;
	handle?: ChildHandle;
	workspaceDispose?: (outcome: { status: RunStatus }) => { resultAddendum?: string } | undefined;
	snapshot?: RunSnapshot;
	activeRun?: ActiveRun;
	teardown?: Promise<void>;
	disposed: boolean;
}

function abortActiveRun(entry: ChildEntry): Promise<void> {
	const activeRun = entry.activeRun;
	if (!activeRun) return Promise.resolve();
	activeRun.controller.abort();
	if (!entry.session.isStreaming) return activeRun.sessionAbort ?? Promise.resolve();
	activeRun.sessionAbort ??= entry.session.abort();
	return activeRun.sessionAbort;
}

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
		throw new DelegationError(
			"not-implemented",
			"WorkspaceProvider has no V1 consumer — children share the parent cwd",
		);
	}
	return spec.session;
}

async function acquireOrAbort(
	semaphore: Semaphore,
	signal: AbortSignal | undefined,
): Promise<(() => void) | undefined> {
	const slot = semaphore.acquire();
	if (!signal) return slot;
	const releaseEventually = () => void slot.then((release) => release());
	if (signal.aborted) {
		releaseEventually();
		return undefined;
	}
	let onAbort = () => {};
	const aborted = new Promise<undefined>((resolveAborted) => {
		onAbort = () => resolveAborted(undefined);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	const winner = await Promise.race([slot, aborted]);
	signal.removeEventListener("abort", onAbort);
	if (winner === undefined) releaseEventually();
	return winner;
}

interface RunBaseline {
	messageCount: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function baselineOf(session: AgentSession): RunBaseline {
	const stats = session.getSessionStats();
	return {
		messageCount: session.messages.length,
		input: stats.tokens.input,
		output: stats.tokens.output,
		cacheRead: stats.tokens.cacheRead,
		cacheWrite: stats.tokens.cacheWrite,
		cost: stats.cost,
	};
}

function lastAssistant(session: AgentSession, fromIndex: number): AssistantMessage | undefined {
	for (let i = session.messages.length - 1; i >= fromIndex; i--) {
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

	const fallbackRuntimes = new Map<
		string,
		{ runtime: Promise<ModelRuntime>; mirroredProviderIds: Set<string> }
	>();

	function synchronizeRegisteredProviders(
		runtime: ModelRuntime,
		mirroredProviderIds: Set<string>,
		parent: ParentContext,
	): void {
		const registry = parent.modelRegistry;
		if (!registry) return;
		const registeredIds = new Set(registry.getRegisteredProviderIds());
		for (const providerId of mirroredProviderIds) runtime.unregisterProvider(providerId);
		mirroredProviderIds.clear();
		for (const providerId of registeredIds) {
			const nativeProvider = registry.getRegisteredNativeProvider(providerId);
			if (nativeProvider) {
				runtime.registerNativeProvider(nativeProvider);
				mirroredProviderIds.add(providerId);
				continue;
			}
			const providerConfig = registry.getRegisteredProviderConfig(providerId);
			if (providerConfig) {
				runtime.registerProvider(providerId, providerConfig);
				mirroredProviderIds.add(providerId);
			}
		}
	}

	async function getFallbackRuntime(
		parentSessionId: string,
		parent: ParentContext,
	): Promise<ModelRuntime> {
		const bound = bindings.modelRuntime;
		if (typeof bound === "function") return bound();
		if (bound) return bound;
		let fallback = fallbackRuntimes.get(parentSessionId);
		if (!fallback) {
			fallback = { runtime: ModelRuntime.create(), mirroredProviderIds: new Set() };
			fallbackRuntimes.set(parentSessionId, fallback);
		}
		const runtime = await fallback.runtime;
		synchronizeRegisteredProviders(runtime, fallback.mirroredProviderIds, parent);
		return runtime;
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
		baseline: RunBaseline,
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
				input: stats.tokens.input - baseline.input,
				output: stats.tokens.output - baseline.output,
				cacheRead: stats.tokens.cacheRead - baseline.cacheRead,
				cacheWrite: stats.tokens.cacheWrite - baseline.cacheWrite,
				cost: stats.cost - baseline.cost,
				turns,
				contextTokens: contextUsage?.tokens ?? 0,
			},
			durationMs: Date.now() - startedAt,
			...(activity !== undefined ? { activity } : {}),
		};
	}

	async function driveRun(
		entry: ChildEntry,
		task: string,
		opts: RunOptions,
		baseline: RunBaseline,
		startedAt: number,
	): Promise<RunOutcome> {
		const { session } = entry;
		const cap = opts.maxTurns;
		let turns = 0;
		let activity: string | undefined;
		let capSteered = false;
		let abortRequested = false;

		const pushUpdate = (status: RunLifecycleStatus) => {
			const details = buildDetails(entry, task, status, turns, activity, startedAt, baseline);
			if (entry.snapshot?.task === task) entry.snapshot = { ...entry.snapshot, status, details };
			opts.onUpdate?.(details);
		};

		const unsubscribe = session.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				activity = event.toolName;
				pushUpdate("running");
			} else if (event.type === "turn_end") {
				turns++;
				const continues =
					event.message.role === "assistant" &&
					event.message.content.some((block) => block.type === "toolCall");
				if (cap !== undefined && turns >= cap && continues && !capSteered) {
					capSteered = true;
					void session.steer(WRAP_UP_INSTRUCTION).catch(() => {});
				}
				pushUpdate("running");
			} else if (event.type === "turn_start") {
				if (cap !== undefined && turns > cap) {
					abortRequested = true;
					void session.abort().catch(() => {});
				}
			}
		});

		const onAbort = () => {
			abortRequested = true;
			void abortActiveRun(entry).catch(() => {});
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		if (opts.signal?.aborted) onAbort();

		let thrownMessage: string | undefined;
		try {
			if (!abortRequested) await session.prompt(task);
		} catch (error) {
			thrownMessage = error instanceof Error ? error.message : String(error);
		} finally {
			unsubscribe();
			opts.signal?.removeEventListener("abort", onAbort);
			session.clearQueue();
		}

		const last = lastAssistant(session, baseline.messageCount);
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
		const details = buildDetails(entry, task, status, turns, activity, startedAt, baseline);
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
		let resolveSettled = () => {};
		const activeRun: ActiveRun = {
			controller: new AbortController(),
			settled: new Promise<void>((resolve) => {
				resolveSettled = resolve;
			}),
			resolveSettled: () => resolveSettled(),
		};
		entry.activeRun = activeRun;
		const forwardCallerAbort = () => activeRun.controller.abort(opts.signal?.reason);
		if (opts.signal?.aborted) forwardCallerAbort();
		else opts.signal?.addEventListener("abort", forwardCallerAbort, { once: true });
		const runOpts: RunOptions = { ...opts, signal: activeRun.controller.signal };

		try {
			const startedAt = Date.now();
			const baseline = baselineOf(entry.session);
			const queuedDetails = buildDetails(entry, task, "queued", 0, undefined, startedAt, baseline);
			entry.snapshot = {
				status: "queued",
				task,
				details: queuedDetails,
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
			const release = await acquireOrAbort(
				semaphoreFor(entry.record.parentSessionId),
				runOpts.signal,
			);
			try {
				let outcome: RunOutcome;
				if (release === undefined || entry.disposed || runOpts.signal?.aborted) {
					outcome = {
						status: "aborted",
						details: buildDetails(entry, task, "aborted", 0, undefined, startedAt, baseline),
						errorMessage: entry.disposed ? "disposed before start" : "aborted before start",
					};
				} else {
					const runStartedAt = Date.now();
					const runningDetails = buildDetails(
						entry,
						task,
						"running",
						0,
						undefined,
						runStartedAt,
						baseline,
					);
					entry.snapshot = { ...entry.snapshot, status: "running", details: runningDetails };
					runOpts.onUpdate?.(runningDetails);
					emit(
						{
							type: "run-started",
							sessionId: entry.record.sessionId,
							parentSessionId: entry.record.parentSessionId,
						},
						entry,
					);
					outcome = await driveRun(entry, task, runOpts, baseline, runStartedAt);
				}
				entry.snapshot = {
					status: outcome.status,
					task,
					details: outcome.details,
					...(outcome.finalText !== undefined ? { finalText: outcome.finalText } : {}),
					...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
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
				release?.();
			}
		} finally {
			opts.signal?.removeEventListener("abort", forwardCallerAbort);
			activeRun.resolveSettled();
			if (entry.activeRun === activeRun) delete entry.activeRun;
		}
	}

	function disposeChild(entry: ChildEntry): Promise<void> {
		entry.disposed = true;
		void abortActiveRun(entry).catch(() => {});
		entry.teardown ??= Promise.resolve().then(() => teardownChild(entry));
		return entry.teardown;
	}

	async function teardownChild(entry: ChildEntry): Promise<void> {
		const activeRun = entry.activeRun;
		if (activeRun) {
			await abortActiveRun(entry).catch(() => {});
			await activeRun.settled;
		}
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
				await abortActiveRun(entry);
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
		const runtime = parent.modelRuntime ?? (await getFallbackRuntime(spec.parent, parent));
		const model = options.model
			? runtime.getModel(options.model.provider, options.model.id)
			: parent.model;
		if (options.model && !model) {
			throw new Error(
				`Unknown model ${options.model.provider}/${options.model.id} — resolve against available models before createChild`,
			);
		}
		const thinkingLevel = options.thinkingLevel ?? parent.thinkingLevel;
		const cwd = parent.cwd;

		const settingsManager = SettingsManager.create(cwd);
		const skills = options.skills ?? [];
		const systemPrompt = options.systemPrompt;
		const childFactories =
			options.extensions === true ? (bindings.childExtensionFactories ?? []) : [];
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir: getAgentDir(),
			settingsManager,
			noExtensions: true,
			...(childFactories.length > 0 ? { extensionFactories: childFactories } : {}),
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
		if (childFactories.length > 0) await session.bindExtensions({ mode: "print" });

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
			const entries = [...(byParent.get(parentSessionId) ?? [])].flatMap((id) => {
				const entry = children.get(id);
				return entry ? [entry] : [];
			});
			for (const entry of entries) entry.disposed = true;
			for (const entry of entries) void abortActiveRun(entry).catch(() => {});
			await Promise.all(entries.map(disposeChild));
			byParent.delete(parentSessionId);
			semaphores.delete(parentSessionId);
			fallbackRuntimes.delete(parentSessionId);
		},
	};
}
