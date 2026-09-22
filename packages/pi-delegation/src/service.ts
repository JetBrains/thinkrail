import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { captureBranch, captureSession, forkCaptured } from "./history";
import { Semaphore } from "./semaphore";
import {
	assertSegment,
	DEFAULT_SCOPE,
	defaultDelegationRoot,
	delegationSessionDir,
	locateResourceTranscript,
	resourceSessionDir,
} from "./storage";
import {
	type ChildHandle,
	type CreateChildSpec,
	type DelegationBindings,
	DelegationError,
	type DelegationRunDetails,
	type DelegationService,
	type LifecycleEvent,
	type ParentContext,
	type ResourceChildBirth,
	type ResourceChildHandle,
	type ResourceContextInput,
	type ResourceDelegation,
	type ResourceDelegationOptions,
	type ResourceSpawnRecord,
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

interface ResourceState {
	readonly id: string;
	context?: Promise<PreparedContext>;
	semaphore?: Semaphore;
	readonly factories: ExtensionFactory[];
	readonly children: Map<string, ChildEntry>;
	readonly pending: Set<Promise<unknown>>;
	readonly opening: Set<string>;
	closed: boolean;
	release?: Promise<void>;
}

interface PreparedContext {
	cwd: string;
	runtime: ModelRuntime;
	model?: SessionOptions["model"];
	thinkingLevel?: SessionOptions["thinkingLevel"];
	unsupportedProviders: Set<string>;
}

interface ChildEntry {
	readonly record: SpawnRecord | ResourceSpawnRecord;
	readonly semaphore: Semaphore;
	readonly resource?: ResourceState;
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
	if (entry.resource) {
		entry.session.clearQueue();
		entry.session.abortCompaction();
		entry.session.abortRetry();
	}
	if (!entry.session.isStreaming) return activeRun.sessionAbort ?? Promise.resolve();
	activeRun.sessionAbort ??= entry.session.abort();
	return activeRun.sessionAbort;
}

function assertV1Combination(spec: Omit<CreateChildSpec, "parent">): SessionOptions {
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
	if (originKind !== "fresh" && originKind !== "fork-captured") {
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
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function baselineOf(session: AgentSession): RunBaseline {
	const stats = session.getSessionStats();
	return {
		input: stats.tokens.input,
		output: stats.tokens.output,
		cacheRead: stats.tokens.cacheRead,
		cacheWrite: stats.tokens.cacheWrite,
		cost: stats.cost,
	};
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
	const resources = new Map<string, ResourceState>();
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

	function emitRun(entry: ChildEntry, type: "run-queued" | "run-started"): void {
		if ("parentSessionId" in entry.record)
			emit(
				{ type, sessionId: entry.record.sessionId, parentSessionId: entry.record.parentSessionId },
				entry,
			);
	}

	function steerResource(entry: ChildEntry, activeRun: ActiveRun | undefined, text: string): void {
		if (entry.disposed)
			throw new DelegationError("disposed", `Child ${entry.record.sessionId} is disposed`);
		if (
			!activeRun ||
			entry.activeRun !== activeRun ||
			activeRun.controller.signal.aborted ||
			!entry.session.isStreaming
		) {
			throw new DelegationError(
				"not-running",
				"Resource steering requires an active streaming invocation",
			);
		}
		entry.session.agent.steer({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
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
		let last: AssistantMessage | undefined;
		const activeRun = entry.activeRun;

		const pushUpdate = (status: RunLifecycleStatus) => {
			const details = buildDetails(entry, task, status, turns, activity, startedAt, baseline);
			if (entry.snapshot?.task === task) entry.snapshot = { ...entry.snapshot, status, details };
			opts.onUpdate?.(details);
		};

		const unsubscribe = session.subscribe((event) => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				last = event.message;
			}
			if (opts.signal?.aborted && event.type === "agent_start") {
				session.clearQueue();
				session.agent.abort();
			}
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
					if (entry.resource) {
						try {
							steerResource(entry, activeRun, WRAP_UP_INSTRUCTION);
						} catch {}
					} else void session.steer(WRAP_UP_INSTRUCTION).catch(() => {});
				}
				pushUpdate("running");
			} else if (event.type === "turn_start") {
				if (cap !== undefined && turns > cap) {
					abortRequested = true;
					void (entry.resource ? abortActiveRun(entry) : session.abort()).catch(() => {});
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
			if (!abortRequested)
				await session.prompt(
					task,
					entry.resource
						? {
								expandPromptTemplates: false,
								source: "extension",
								preflightResult: () => {
									if (opts.signal?.aborted) throw new Error("Cancelled during prompt preflight");
								},
							}
						: undefined,
				);
		} catch (error) {
			thrownMessage = error instanceof Error ? error.message : String(error);
		} finally {
			unsubscribe();
			opts.signal?.removeEventListener("abort", onAbort);
			session.clearQueue();
		}

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
			historyEntryId: session.sessionManager.getLeafId(),
			...(last ? { stopReason: last.stopReason } : {}),
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
		if (entry.activeRun) {
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
			emitRun(entry, "run-queued");
			const release = await acquireOrAbort(entry.semaphore, runOpts.signal);
			try {
				let outcome: RunOutcome;
				if (release === undefined || entry.disposed || runOpts.signal?.aborted) {
					outcome = {
						status: "aborted",
						historyEntryId: entry.session.sessionManager.getLeafId(),
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
					emitRun(entry, "run-started");
					outcome = await driveRun(entry, task, runOpts, baseline, runStartedAt);
				}
				entry.session.clearQueue();
				entry.snapshot = {
					status: outcome.status,
					task,
					details: outcome.details,
					...(outcome.finalText !== undefined ? { finalText: outcome.finalText } : {}),
					...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
					collected: false,
				};
				if ("parentSessionId" in entry.record)
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
			entry.session.clearQueue();
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
		try {
			if (entry.resource)
				await entry.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		} finally {
			entry.session.dispose();
			if ("parentSessionId" in entry.record) {
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
			} else entry.resource?.children.delete(entry.record.sessionId);
		}
	}

	function makeHandle(entry: ChildEntry): ChildHandle {
		const record = entry.record;
		if (!("parentSessionId" in record))
			throw new DelegationError("invalid-child-record", "Not a parent child");
		return {
			get sessionId() {
				return entry.record.sessionId;
			},
			get record() {
				return record;
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

	async function assemble(
		options: SessionOptions,
		cwd: string,
		runtime: ModelRuntime,
		model: AgentSession["model"],
		thinkingLevel: SessionOptions["thinkingLevel"],
		factories: ExtensionFactory[],
		manager: SessionManager,
	): Promise<AgentSession> {
		const settingsManager = SettingsManager.create(cwd);
		const skills = options.skills ?? [];
		const systemPrompt = options.systemPrompt;
		const childFactories = options.extensions === true ? factories : [];
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

		const { session } = await createAgentSession({
			cwd,
			modelRuntime: runtime,
			sessionManager: manager,
			settingsManager,
			resourceLoader,
			...(model ? { model } : {}),
			...(thinkingLevel !== undefined
				? { thinkingLevel }
				: manager.getEntries().length > 0
					? {
							thinkingLevel:
								(model
									? settingsManager.getModelThinkingLevel(model.provider, model.id)
									: undefined) ??
								settingsManager.getDefaultThinkingLevel() ??
								"medium",
						}
					: {}),
			...(options.tools !== undefined ? { tools: options.tools } : {}),
			...(options.excludeTools !== undefined ? { excludeTools: options.excludeTools } : {}),
		});
		try {
			const effectiveModel = session.model;
			const savedContext = manager.buildSessionContext();
			if (
				effectiveModel &&
				(savedContext.model?.provider !== effectiveModel.provider ||
					savedContext.model?.modelId !== effectiveModel.id)
			)
				manager.appendModelChange(effectiveModel.provider, effectiveModel.id);
			if (savedContext.thinkingLevel !== session.thinkingLevel)
				manager.appendThinkingLevelChange(session.thinkingLevel);
			if (childFactories.length > 0) await session.bindExtensions({ mode: "print" });
			return session;
		} catch (error) {
			try {
				await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			} finally {
				session.dispose();
			}
			throw error;
		}
	}

	function newManager(
		spec: Omit<CreateChildSpec, "parent">,
		cwd: string,
		dir: string,
	): SessionManager {
		return spec.origin?.kind === "fork-captured"
			? forkCaptured(spec.origin.history, cwd, dir)
			: SessionManager.create(cwd, dir);
	}

	function birthFields(spec: Omit<CreateChildSpec, "parent">, session: AgentSession) {
		return {
			sessionId: session.sessionId,
			scope,
			originKind: spec.origin?.kind === "fork-captured" ? ("fork" as const) : ("fresh" as const),
			...(spec.origin?.kind === "fork-captured" && spec.origin.history.entryId !== null
				? { entryId: spec.origin.history.entryId }
				: {}),
			info: Object.freeze({ ...spec.info }),
			interactive: false,
			visibility: "hidden" as const,
			createdAt: new Date().toISOString(),
			sessionFile: session.sessionManager.getSessionFile() ?? "",
		};
	}

	async function createChild(spec: CreateChildSpec): Promise<ChildHandle> {
		const options = assertV1Combination(spec);
		const parent = bindings.resolveParent?.(spec.parent);
		if (!parent)
			throw new DelegationError(
				"unknown-parent",
				`Parent session ${spec.parent} is not live — children derive their defaults from a live parent`,
			);
		const runtime = parent.modelRuntime ?? (await getFallbackRuntime(spec.parent, parent));
		const model = options.model
			? runtime.getModel(options.model.provider, options.model.id)
			: parent.model;
		if (options.model && !model)
			throw new Error(
				`Unknown model ${options.model.provider}/${options.model.id} — resolve against available models before createChild`,
			);
		const manager = newManager(
			spec,
			parent.cwd,
			delegationSessionDir(delegationRoot, scope, spec.parent),
		);
		const session = await assemble(
			options,
			parent.cwd,
			runtime,
			model,
			options.thinkingLevel ?? parent.thinkingLevel,
			bindings.childExtensionFactories ?? [],
			manager,
		);
		const record: SpawnRecord = Object.freeze({
			...birthFields(spec, session),
			parentSessionId: spec.parent,
		});
		const entry: ChildEntry = {
			record,
			session,
			semaphore: semaphoreFor(spec.parent),
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

	function checkModel(
		context: PreparedContext,
		reference: SessionOptions["model"],
	): NonNullable<AgentSession["model"]> {
		if (!reference || typeof reference.provider !== "string" || typeof reference.id !== "string") {
			throw new DelegationError("model-unavailable", "An effective resource model is required");
		}
		if (context.unsupportedProviders.has(reference.provider))
			throw new DelegationError(
				"unsupported-auth",
				`Provider ${reference.provider} requires the original runtime for runtime-only authentication`,
			);
		const model = context.runtime.getModel(reference.provider, reference.id);
		if (!model)
			throw new DelegationError(
				"model-unavailable",
				`Unknown model ${reference.provider}/${reference.id}`,
			);
		return model;
	}

	async function prepareContext(input: ResourceContextInput): Promise<PreparedContext> {
		const defaults = {
			cwd: input.cwd,
			...(input.model ? { model: { ...input.model } } : {}),
			...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
		};
		if (typeof defaults.cwd !== "string" || !defaults.cwd)
			throw new DelegationError("invalid-combination", "Resource cwd is required");
		const unsupportedProviders = new Set<string>();
		if (input.kind === "runtime")
			return { ...defaults, runtime: input.modelRuntime, unsupportedProviders };
		const registry = input.modelRegistry;
		const registrations = registry.getRegisteredProviderIds().map((id) => ({
			id,
			native: registry.getRegisteredNativeProvider(id),
			config: registry.getRegisteredProviderConfig(id),
		}));
		const providerIds = new Set(registry.getAll().map((model) => model.provider));
		const configuredProviders = new Set<string>();
		for (const providerId of providerIds) {
			const auth = registry.getProviderAuthStatus(providerId);
			if (auth.source === "runtime") unsupportedProviders.add(providerId);
			if (auth.source === "stored") configuredProviders.add(providerId);
		}
		const runtime = await ModelRuntime.create({ allowModelNetwork: false });
		for (const registration of registrations) {
			if (registration.native) runtime.registerNativeProvider(registration.native);
			else if (registration.config) runtime.registerProvider(registration.id, registration.config);
		}
		for (const providerId of configuredProviders) {
			if (!runtime.getProviderAuthStatus(providerId).configured)
				unsupportedProviders.add(providerId);
		}
		return { ...defaults, runtime, unsupportedProviders };
	}

	function preparedContext(resource: ResourceState): Promise<PreparedContext> {
		assertOpen(resource);
		if (!resource.context) throw new DelegationError("disposed", "Resource context was released");
		return resource.context;
	}

	function assertOpen(resource: ResourceState): void {
		if (resource.closed)
			throw new DelegationError("disposed", `Resource ${resource.id} is released`);
	}

	function track<T>(resource: ResourceState, operation: () => Promise<T>): Promise<T> {
		assertOpen(resource);
		const pending = operation();
		resource.pending.add(pending);
		void pending.then(
			() => resource.pending.delete(pending),
			() => resource.pending.delete(pending),
		);
		return pending;
	}

	function validateSessionOptions(options: SessionOptions): void {
		if (
			!options ||
			typeof options !== "object" ||
			[options.tools, options.excludeTools, options.skills].some(
				(value) =>
					value !== undefined &&
					(!Array.isArray(value) || value.some((item) => typeof item !== "string")),
			) ||
			(options.model !== undefined &&
				(!options.model ||
					typeof options.model.provider !== "string" ||
					!options.model.provider ||
					typeof options.model.id !== "string" ||
					!options.model.id)) ||
			(options.systemPrompt !== undefined && typeof options.systemPrompt !== "string") ||
			(options.contextFiles !== undefined && typeof options.contextFiles !== "boolean") ||
			(options.extensions !== undefined && typeof options.extensions !== "boolean") ||
			(options.thinkingLevel !== undefined &&
				!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
					options.thinkingLevel,
				))
		) {
			throw new DelegationError("invalid-child-record", "Invalid saved session configuration");
		}
	}

	function validateBirth(resource: ResourceState, birth: ResourceChildBirth): ResourceChildBirth {
		if (
			!birth ||
			birth.resourceId !== resource.id ||
			birth.scope !== scope ||
			birth.visibility !== "hidden" ||
			birth.interactive !== false ||
			(birth.originKind !== "fresh" && birth.originKind !== "fork") ||
			!birth.info ||
			typeof birth.info.createdBy !== "string" ||
			!birth.info.createdBy ||
			(birth.info.roleName !== undefined && typeof birth.info.roleName !== "string") ||
			(birth.info.roleSource !== undefined && typeof birth.info.roleSource !== "string") ||
			typeof birth.createdAt !== "string" ||
			!Number.isFinite(Date.parse(birth.createdAt)) ||
			("entryId" in birth &&
				(birth.originKind !== "fork" || typeof birth.entryId !== "string" || !birth.entryId))
		) {
			throw new DelegationError("invalid-child-record", "Invalid resource child birth metadata");
		}
		assertSegment(birth.sessionId, "invalid-child-record");
		return Object.freeze({
			sessionId: birth.sessionId,
			resourceId: birth.resourceId,
			scope: birth.scope,
			originKind: birth.originKind,
			...(birth.entryId !== undefined ? { entryId: birth.entryId } : {}),
			info: Object.freeze({ ...birth.info }),
			interactive: birth.interactive,
			visibility: birth.visibility,
			createdAt: birth.createdAt,
		});
	}

	async function createResourceChild(
		resource: ResourceState,
		spec: Omit<CreateChildSpec, "parent">,
		birth?: ResourceChildBirth,
	): Promise<ResourceChildHandle> {
		const options = assertV1Combination(spec);
		validateSessionOptions(options);
		if (
			!spec.info ||
			typeof spec.info.createdBy !== "string" ||
			!spec.info.createdBy ||
			(spec.info.roleName !== undefined && typeof spec.info.roleName !== "string") ||
			(spec.info.roleSource !== undefined && typeof spec.info.roleSource !== "string")
		) {
			throw new DelegationError("invalid-child-record", "Invalid resource child info");
		}
		const context = await preparedContext(resource);
		assertOpen(resource);
		const model = checkModel(context, options.model ?? context.model);
		const dir = resourceSessionDir(delegationRoot, scope, resource.id);
		let manager: SessionManager;
		if (birth) {
			const located = locateResourceTranscript(delegationRoot, scope, resource.id, birth.sessionId);
			manager = SessionManager.open(located.file, dir);
			if (manager.getSessionId() !== birth.sessionId) {
				throw new DelegationError(
					"invalid-child-transcript",
					"Transcript identity changed while reopening",
				);
			}
		} else manager = newManager(spec, context.cwd, dir);
		const session = await assemble(
			options,
			context.cwd,
			context.runtime,
			model,
			options.thinkingLevel ?? context.thinkingLevel,
			[...(bindings.childExtensionFactories ?? []), ...resource.factories],
			manager,
		);
		const record: ResourceSpawnRecord = Object.freeze(
			birth
				? { ...birth, sessionFile: manager.getSessionFile() ?? "" }
				: { ...birthFields(spec, session), resourceId: resource.id },
		);
		const semaphore = resource.semaphore;
		if (!semaphore) {
			session.dispose();
			throw new DelegationError("disposed", "Resource pacing was released");
		}
		const entry: ChildEntry = {
			record,
			session,
			resource,
			semaphore,
			listeners: new Set(),
			disposed: false,
		};
		resource.children.set(record.sessionId, entry);
		if (resource.closed) {
			await disposeChild(entry);
			throw new DelegationError("disposed", `Resource ${resource.id} released during assembly`);
		}
		return {
			sessionId: record.sessionId,
			record,
			runQueued: (task, opts = {}) => runQueued(entry, task, opts),
			steer: async (text) => steerResource(entry, entry.activeRun, text),
			abort: async () => {
				const activeRun = entry.activeRun;
				await abortActiveRun(entry);
				await activeRun?.settled;
			},
			dispose: () => disposeChild(entry),
		};
	}

	function releaseResource(resource: ResourceState): Promise<void> {
		resource.closed = true;
		for (const entry of resource.children.values()) entry.disposed = true;
		for (const entry of resource.children.values()) void abortActiveRun(entry).catch(() => {});
		resource.release ??= (async () => {
			await Promise.allSettled([...resource.pending]);
			const settled = await Promise.allSettled([...resource.children.values()].map(disposeChild));
			resources.delete(resource.id);
			resource.factories.length = 0;
			delete resource.context;
			delete resource.semaphore;
			const failed = settled.find((result) => result.status === "rejected");
			if (failed?.status === "rejected") throw failed.reason;
		})();
		return resource.release;
	}

	async function registerResource(
		id: string,
		input: ResourceContextInput,
		options: ResourceDelegationOptions = {},
	): Promise<ResourceDelegation> {
		resourceSessionDir(delegationRoot, scope, id);
		if (resources.has(id))
			throw new DelegationError("resource-exists", `Resource ${id} is already registered`);
		const semaphore = new Semaphore(options.maxConcurrent ?? slotsPerParent);
		const resource: ResourceState = {
			id,
			context: prepareContext(input),
			semaphore,
			factories: [...(options.childExtensionFactories ?? [])],
			children: new Map(),
			pending: new Set(),
			opening: new Set(),
			closed: false,
		};
		resources.set(id, resource);
		try {
			const context = await preparedContext(resource);
			if (context.model) checkModel(context, context.model);
		} catch (error) {
			await releaseResource(resource);
			throw error;
		}
		return {
			validateModels: async (models) =>
				track(resource, async () => {
					const context = await preparedContext(resource);
					assertOpen(resource);
					for (const model of models) checkModel(context, model);
				}),
			createChild: async (spec) => track(resource, () => createResourceChild(resource, spec)),
			reopenChild: async ({ birth: inputBirth, session }) =>
				track(resource, async () => {
					const birth = validateBirth(resource, inputBirth);
					if (resource.children.has(birth.sessionId) || resource.opening.has(birth.sessionId))
						throw new DelegationError("invalid-child-record", "Child is already live or opening");
					resource.opening.add(birth.sessionId);
					try {
						return await createResourceChild(
							resource,
							{
								info: birth.info,
								visibility: birth.visibility,
								interactive: birth.interactive,
								session,
							},
							birth,
						);
					} finally {
						resource.opening.delete(birth.sessionId);
					}
				}),
			release: () => releaseResource(resource),
		};
	}

	return {
		registerResource,
		captureHistory: async (source) => {
			if (source.kind === "session") {
				try {
					return captureSession(source);
				} catch (error) {
					if (error instanceof DelegationError) throw error;
					throw new DelegationError(
						"history-unavailable",
						`Cannot read session evidence: ${String(error)}`,
					);
				}
			}
			const resource = resources.get(source.resourceId);
			if (resource?.opening.has(source.sessionId))
				throw new DelegationError("source-busy", "Resource child is opening");
			const live = resource?.children.get(source.sessionId);
			if (live && (live.activeRun || live.disposed || live.teardown))
				throw new DelegationError("source-busy", "Resource child has work or teardown in flight");
			try {
				const { transcript } = locateResourceTranscript(
					delegationRoot,
					scope,
					source.resourceId,
					source.sessionId,
				);
				return captureBranch(transcript, source.entryId);
			} catch (error) {
				if (error instanceof DelegationError && error.code === "child-transcript-unavailable")
					throw new DelegationError("history-unavailable", error.message);
				if (
					error instanceof DelegationError &&
					(error.code === "invalid-child-transcript" || error.code === "invalid-child-record")
				)
					throw new DelegationError("invalid-history", error.message);
				throw error;
			}
		},
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
