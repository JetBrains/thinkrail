import { createReadStream, existsSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
// Value imports of PURE catalog helpers (data-only projections over `Model`) — the only root
// value-imports the module boundary allows; dispatch stays on the shared `ModelRuntime` (SPEC §Allowed deps).
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	getAgentDir,
	type SessionInfo,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentSettlement,
	AskUserQuestionResult,
	ImageContent,
	Model,
	RefreshedModels,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "@thinkrail/contracts";
import { isTranscriptMessageRole } from "@thinkrail/contracts";
import { ANSWERABILITY_ERRORS, assessAnswerability, buildAnswersMessage } from "./askUserQuestion";
import { buildResourceLoader, toSkillCommands } from "./extensions";
import {
	getPiRuntime,
	getPiRuntimeGeneration,
	type PiRuntimeGeneration,
	refreshCatalogs,
	settledAvailableModels,
} from "./piRuntime";
import { projectSessionEvent } from "./sessionEventProjection";
import { repairDanglingToolCalls } from "./sessionRepair";
import type { SkillAdmissionContext } from "./skillAdmission";
import { trashFile } from "./trash";
import { cancelExtUiForSession, createWebUiContext, notifyExtUi } from "./webUiContext";

interface Entry {
	session: AgentSession;
	/** Runtime generation captured when this session was created or attached. */
	generation: PiRuntimeGeneration;
	unsubscribe: () => void;
	/** The workspace this session belongs to — so `listSessions` can report a workspace's sessions. */
	workspaceId: string;
	/** Latest live terminal; undefined before observation, null while active or with no assistant. */
	lastSettlement: AgentSettlement | null | undefined;
}

const sessions = new Map<string, Entry>();

/** Public auth/dev seam: capture the current runtime for the callback's complete async lifetime. */
export async function usePiRuntime<T>(
	operation: (
		runtime: PiRuntimeGeneration["runtime"],
		generation: PiRuntimeGeneration,
	) => Promise<T> | T,
): Promise<T> {
	const generation = await getPiRuntimeGeneration();
	return operation(generation.runtime, generation);
}

// Permanent for this host lifetime. A process restart naturally clears it; by then the trashed transcript
// is absent, or the user deliberately restored it from the OS trash.
const deletedSessions = new Map<string, string>();

// In-flight delete transactions, keyed by session id. A second trash click on the same chat (another tab
// or another client) joins the running transaction instead of starting a rival one — so the tombstone is
// installed and cleared by exactly one owner, never cleared by a loser while the winner's move is pending.
const deletingSessions = new Map<string, { workspaceId: string; done: Promise<void> }>();

function isSessionDeleted(sessionId: string, workspaceId: string): boolean {
	return deletedSessions.get(sessionId) === workspaceId;
}

// `SessionEventPayload` is a wire type — it lives in `@thinkrail/contracts`; re-exported so the
// `../agent` barrel keeps exposing it.
export type { SessionEventPayload };

let publish: (payload: SessionEventPayload) => void = () => {};
export function setSessionPublisher(fn: (payload: SessionEventPayload) => void): void {
	publish = fn;
}

let publishDeleted: (payload: SessionDeletedPayload) => void = () => {};
export function setSessionDeletedPublisher(fn: (payload: SessionDeletedPayload) => void): void {
	publishDeleted = fn;
}

// Per-session persistence. Overridable so tests can use `SessionManager.inMemory()` (no disk).
let sessionManagerFactory: (cwd: string) => SessionManager = (cwd) => SessionManager.create(cwd);
export function setSessionManagerFactory(factory: (cwd: string) => SessionManager): void {
	sessionManagerFactory = factory;
}

/**
 * Host seam: resolve a workspace's **skill-admission context** — the owning project's trust + acknowledged
 * set + baseline disables, plus that workspace's per-skill overrides. Gates which skills a session loads
 * (see `buildResourceLoader` / `skillAdmission`). Keyed by `workspaceId`, the one id both the create and
 * disk-restore paths hold. Fails closed (nothing trusted/acknowledged) until the host wires the real
 * resolver at boot, so a mis-wire can never silently load an untrusted repo's skills.
 */
let skillAdmissionResolver: (workspaceId: string) => SkillAdmissionContext = () => ({
	trusted: false,
	acknowledged: [],
	disabled: [],
	disabledGroups: [],
	overrides: {},
});
export function setSkillAdmissionResolver(
	resolver: (workspaceId: string) => SkillAdmissionContext,
): void {
	skillAdmissionResolver = resolver;
}

function hasDeletionTombstone(sessionId: string): boolean {
	return deletedSessions.has(sessionId);
}

function mustGetEntry(sessionId: string): Entry {
	// A live entry deliberately remains registered while its transcript move is pending so trash failure
	// can restore the same runtime. It is not command-addressable in that window: accepting a new turn
	// after deletion began could append behind the move and lose or recreate the supposedly deleted chat.
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return entry;
}

function mustGet(sessionId: string): AgentSession {
	return mustGetEntry(sessionId).session;
}

/** Whether a session is live and command-addressable — false while a delete transaction owns it. */
export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId) && !hasDeletionTombstone(sessionId);
}

/** The workspace a live session belongs to — the host's session→workspace lookup (e.g. auto-rename). */
export function getSessionWorkspaceId(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.workspaceId;
}

/**
 * Re-scan skills/settings and rebuild the system prompt for a live session — the active-chat "Reload skills"
 * path, so a trust grant or a worktree skill change lands without dropping the conversation. Refuses while
 * the session is streaming (pi's reload rebuilds the runtime; mid-turn would desync) — the caller retries
 * after the turn. Throws for an unknown session.
 */
export async function reloadSessionResources(sessionId: string): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		throw new Error(
			"Can't reload skills while the session is streaming — try again after the turn.",
		);
	}
	await session.reload();
}

/**
 * The pi settings a session runs with: the user's real settings **plus** an in-memory override turning
 * `images.autoResize` **off** (never persisted — `applyOverrides`, not `set…`+`save`). With it off, the
 * `read` tool sends image files to the model **raw** instead of routing them through pi's photon
 * (Rust→WASM) resizer. That's deliberate: the resizer can't be bundled into our single-file binary (its
 * wasm loads via a worker + `fs` path that a compiled binary can't satisfy), and the web UI downsizes
 * user-attached images itself — so we keep image-read working everywhere without depending on photon.
 * `SettingsManager.create(cwd)` defaults its agentDir to `getAgentDir()` (honors `PI_CODING_AGENT_DIR`),
 * matching the manager `createAgentSession` builds when we omit `settingsManager`. `projectTrusted: true`
 * here covers pi-**native** project resources (`.pi` / `.agents`, project settings) — unchanged behavior.
 * The committed **cross-agent skill aliases** carry their own explicit admission gate
 * (`buildResourceLoader`'s `admission` context / `setSkillAdmissionResolver`), not this flag.
 */
export function buildSessionSettings(cwd: string): SettingsManager {
	const settings = SettingsManager.create(cwd, undefined, { projectTrusted: true });
	settings.applyOverrides({ images: { autoResize: false } });
	return settings;
}

export interface CreateSessionInput {
	/** The active workspace's worktree — a chat session belongs to a workspace. */
	cwd: string;
	/** The workspace id, kept alongside the session so it can be listed back per workspace. */
	workspaceId: string;
	/** A wire model reference (`{provider,id}` + display metadata, no `baseUrl`) — re-resolved host-side. */
	model?: WireModel;
	thinkingLevel?: ThinkingLevel;
}

/** The resolved session + the model/thinking it starts with (pi picks defaults from auth + settings). */
export interface CreateSessionResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

/**
 * Project a `pi` `Model` down to the wire's **allowlist** (`WireModel`) — exactly the fields the UI renders.
 * An explicit projection (not a `{...rest}` denylist), so `baseUrl` (the jbcentral proxy secret when wired)
 * and `headers` (can carry auth) — and any future `Model` field — are excluded by default. The UI refers a
 * model back by `{provider,id}`, which the host re-resolves via `resolveWireModel`. This is the single choke
 * point that keeps secrets off every model-bearing wire frame (model.list/default, session.create result,
 * SessionSummary).
 */
export function toWireModel(model: Model<string>): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		reasoning: model.reasoning,
		// Computed, not picked: pi's per-model effort-level truth (reasoning + thinkingLevelMap), so the
		// picker disables unsupported levels instead of relying on pi's silent clamp.
		thinkingLevels: getSupportedThinkingLevels(model),
	};
}

/**
 * Re-resolve a wire model reference back to the real `Model` (with its `baseUrl`) from the registry, matching
 * the picker's universe (the same `settledAvailableModels` read). **Never trust a client-supplied `baseUrl`** — pi's `setModel` /
 * `createAgentSession` use it verbatim, so accepting it would let a client (esp. a remote V2 one) point the
 * agent's model traffic at an arbitrary URL. Throws if the ref isn't an available model.
 */
function resolveWireModel(
	runtime: PiRuntimeGeneration["runtime"],
	ref: Pick<WireModel, "provider" | "id">,
): Model<string> {
	const available = settledAvailableModels(runtime);
	const match = available.find((model) => model.provider === ref.provider && model.id === ref.id);
	if (!match) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return match as unknown as Model<string>;
}

interface PreparedSessionEntry {
	entry: Entry;
	result: CreateSessionResult;
}

/** Prepare event forwarding + extension bindings without replacing an existing stable session id. */
async function prepareSessionEntry(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
	lastSettlement: AgentSettlement | null | undefined = undefined,
): Promise<PreparedSessionEntry> {
	const { sessionId } = session;
	let terminal: AgentSettlement | null = null;
	const entry: Entry = {
		session,
		generation,
		unsubscribe: () => {},
		workspaceId,
		lastSettlement,
	};
	entry.unsubscribe = session.subscribe((event) => {
		if (event.type === "agent_start") {
			entry.lastSettlement = null;
		}
		if (event.type === "agent_end") {
			const assistant = [...event.messages]
				.reverse()
				.find((message) => message.role === "assistant");
			terminal = assistant
				? {
						stopReason: assistant.stopReason,
						...(assistant.errorMessage !== undefined
							? { errorMessage: assistant.errorMessage }
							: {}),
					}
				: null;
		}
		const projected = projectSessionEvent(event, terminal);
		if (event.type === "agent_settled") entry.lastSettlement = terminal;
		if (sessions.get(sessionId) === entry) publish({ sessionId, event: projected });
		if (event.type === "agent_settled") terminal = null;
	});

	try {
		// `rpc` mode = dialog-capable, non-TUI. Failures rethrow generic: diagnostics can carry private config.
		await session.bindExtensions({
			mode: "rpc",
			uiContext: createWebUiContext(sessionId),
			onError: () => notifyExtUi(sessionId, "An extension failed.", "error"),
		});
		if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	} catch (error) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		session.dispose();
		throw error;
	}

	return {
		entry,
		result: {
			sessionId,
			model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
			thinkingLevel: session.thinkingLevel,
		},
	};
}

/** Wire a freshly-created/opened session into the manager. */
async function registerSession(
	session: AgentSession,
	workspaceId: string,
	generation: PiRuntimeGeneration,
): Promise<CreateSessionResult> {
	const prepared = await prepareSessionEntry(session, workspaceId, generation);
	sessions.set(session.sessionId, prepared.entry);
	return prepared.result;
}

/** Create an in-process AgentSession rooted in `cwd`; its events stream out tagged with the session id. */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(input.cwd);
	const { session } = await createAgentSession({
		cwd: input.cwd,
		modelRuntime: generation.runtime,
		sessionManager: sessionManagerFactory(input.cwd),
		settingsManager,
		resourceLoader: await buildResourceLoader(
			input.cwd,
			settingsManager,
			() => skillAdmissionResolver(input.workspaceId),
			generation.excludedSessionExtensionPaths,
		),
		// Re-resolve the wire ref to the real model (with baseUrl) host-side — never the client's baseUrl.
		...(input.model ? { model: resolveWireModel(generation.runtime, input.model) } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	return registerSession(session, input.workspaceId, generation);
}

/** A live session's summary (drawn from the running `AgentSession`). */
function summaryOf(sessionId: string, entry: Entry): SessionSummary {
	const { session } = entry;
	return {
		sessionId,
		workspaceId: entry.workspaceId,
		title: session.sessionName ?? "Chat",
		model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		messageCount: session.messages.length,
		updatedAt: Date.now(),
		live: true,
		...(entry.lastSettlement !== undefined ? { lastSettlement: entry.lastSettlement } : {}),
	};
}

interface SessionFileIdentity {
	id: string;
	cwd: string;
}

type ScannedSessionFile =
	| { path: string; ok: true; identity: SessionFileIdentity }
	| { path: string; ok: false; error: Error };

/** Mirror pi's default cwd→session-directory mapping at the one boundary that must detect errors pi's
 * `SessionManager.list()` intentionally degrades to an empty/partial list. Pinned by disk-backed tests. */
function defaultSessionDirectory(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolve(getAgentDir()), "sessions", safePath);
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

/** Read only far enough to identify a pi transcript. Malformed physical lines before the header are
 * skipped like pi; a parsed non-session first entry, no header, or any I/O failure stays a hard error. */
async function readSessionFileIdentity(path: string): Promise<SessionFileIdentity> {
	const input = createReadStream(path, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof entry !== "object" || entry === null) {
				throw new Error("first parsed entry is not an object");
			}
			const id = Reflect.get(entry, "id");
			if (Reflect.get(entry, "type") !== "session" || typeof id !== "string") {
				throw new Error("first parsed entry is not a session header");
			}
			const headerCwd = Reflect.get(entry, "cwd");
			return { id, cwd: typeof headerCwd === "string" ? headerCwd : "" };
		}
		throw new Error("session header is missing");
	} catch (error) {
		throw new Error(`Session transcript is unreadable or malformed: ${path}`, { cause: error });
	} finally {
		lines.close();
		input.destroy();
	}
}

/** Enumerate every physical transcript in pi's one encoded-cwd directory without swallowing errors. */
async function scanSessionFiles(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<ScannedSessionFile[]> {
	const dir = defaultSessionDirectory(cwd);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw new Error(`Session directory is unreadable: ${dir}`, { cause: error });
	}
	const scanned: ScannedSessionFile[] = [];
	// Sequential on purpose: a long-lived workspace can have hundreds of transcripts, and opening every
	// header at once would turn the safety check itself into an EMFILE failure.
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(dir, name);
		// A registered live session is authoritative from memory. Pi can truncate/rewrite its physical file;
		// observing that tiny window must not turn a healthy live chat into a corrupt detached transcript.
		if (excludedPaths.has(resolve(path))) continue;
		try {
			scanned.push({ path, ok: true, identity: await readSessionFileIdentity(path) });
		} catch (error) {
			scanned.push({
				path,
				ok: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}
	return scanned;
}

/**
 * Pi's list is presentation-friendly: directory/read/parse failures become an empty or partial list. At
 * membership and deletion boundaries that would mean "absent", so preflight every header and verify pi
 * returned every physical file. Only a successful result is authoritative.
 */
async function listSessionInfosStrict(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<SessionInfo[]> {
	const scanned = await scanSessionFiles(cwd, excludedPaths);
	const broken = scanned.find((file) => !file.ok);
	if (broken && !broken.ok) throw broken.error;
	const infos = await SessionManager.list(cwd);
	const listedByPath = new Map(infos.map((info) => [resolve(info.path), info]));
	const omitted = scanned.find((file) => {
		if (!file.ok) return false;
		const listed = listedByPath.get(resolve(file.path));
		return !listed || listed.id !== file.identity.id || listed.cwd !== file.identity.cwd;
	});
	if (omitted) throw new Error(`Session transcript could not be listed: ${omitted.path}`);
	return infos;
}

/**
 * A workspace's chat sessions — live (in-memory) unioned with on-disk ones pi persisted under `cwd`. Live
 * wins on id. This is the domain state a reconnecting/second client hydrates from; the disk half is what
 * survives a host restart. The disk list throws rather than reporting false absence on an unreadable file.
 */
async function listSessionsInternal(workspaceId: string, cwd: string): Promise<SessionSummary[]> {
	const live: SessionSummary[] = [];
	const liveIds = new Set<string>();
	const liveFiles = new Set<string>();
	for (const [sessionId, entry] of sessions) {
		if (entry.workspaceId !== workspaceId || isSessionDeleted(sessionId, workspaceId)) continue;
		live.push(summaryOf(sessionId, entry));
		liveIds.add(sessionId);
		const sessionFile = entry.session.sessionManager.getSessionFile();
		if (sessionFile) liveFiles.add(resolve(sessionFile));
	}
	const infos = await listSessionInfosStrict(cwd, liveFiles);
	// One encoded-cwd dir can alias distinct cwds, so disambiguate on the recorded header cwd; live wins.
	const disk: SessionSummary[] = infos
		.filter(
			(info) =>
				info.cwd === cwd && !liveIds.has(info.id) && !isSessionDeleted(info.id, workspaceId),
		)
		.map((info) => ({
			sessionId: info.id,
			workspaceId,
			title: info.name ?? "Chat",
			// Placeholders until the session is opened (disk metadata doesn't carry model/thinking).
			model: null,
			thinkingLevel: "medium" as ThinkingLevel,
			isStreaming: false,
			messageCount: info.messageCount,
			updatedAt: info.modified.getTime(),
			live: false,
		}));
	return [...live, ...disk];
}

export function listSessions(workspaceId: string, cwd: string): Promise<SessionSummary[]> {
	return listSessionsInternal(workspaceId, cwd);
}

// In-flight disk re-opens, deduped by session id: concurrent `getSessionMessages` for the same disk session
// (two tabs / a fast double-click) must attach it exactly once — a second `AgentSession` on the same id
// would orphan the first (leaked subscription/handles) and have two writers appending one transcript file.
const attaching = new Map<string, Promise<void>>();

/** Re-open a persisted session from disk into the manager (restart survival), keyed by its stable id. */
function attachDiskSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, workspaceId))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	let pending = attaching.get(sessionId);
	if (!pending) {
		pending = openDiskSession(sessionId, workspaceId, cwd).finally(() =>
			attaching.delete(sessionId),
		);
		attaching.set(sessionId, pending);
	}
	return pending;
}

function persistedSessionModelRef(model: unknown): { provider: string; id: string } | undefined {
	if (typeof model !== "object" || model === null) return undefined;
	const provider = Reflect.get(model, "provider");
	const id = Reflect.get(model, "modelId");
	// PI persists "no model" as a ref whose fields are BOTH undefined — distinct from a named model.
	if (provider === undefined && id === undefined) return undefined;
	if (typeof provider !== "string" || !provider || typeof id !== "string" || !id) {
		throw new Error("The chat's saved model is unavailable.");
	}
	return { provider, id };
}

async function openDiskSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	const info = (await listSessionInfosStrict(cwd)).find(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!info) throw new Error(`Unknown session: ${sessionId}`);
	if (sessions.has(sessionId)) return; // attached while we listed
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(cwd);
	const sessionManager = SessionManager.open(info.path);
	const persistedModel = persistedSessionModelRef(sessionManager.buildSessionContext().model);
	// Resolve the exact transcript model up front: PI's create-time fallback would silently switch providers.
	let exactModel: Model<string> | undefined;
	if (persistedModel) {
		try {
			exactModel = resolveWireModel(generation.runtime, persistedModel);
		} catch {
			throw new Error("The chat's saved model is unavailable.");
		}
	}
	// Restart safety net: pair any tool call the last run left dangling (host died mid-tool) with a
	// synthetic result BEFORE the session seeds its context — providers reject unpaired tool calls, and
	// appending behind a live session would desync its in-memory state. See `sessionRepair`.
	repairDanglingToolCalls(sessionManager);
	const { session } = await createAgentSession({
		cwd,
		modelRuntime: generation.runtime,
		sessionManager,
		settingsManager,
		resourceLoader: await buildResourceLoader(
			cwd,
			settingsManager,
			() => skillAdmissionResolver(workspaceId),
			generation.excludedSessionExtensionPaths,
		),
		...(exactModel ? { model: exactModel } : {}),
	});
	// Lost a race after the open — drop this duplicate rather than clobber the registered one.
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	await registerSession(session, workspaceId, generation);
}

/**
 * Make a persisted session live again so it can be prompted — a no-op when it already is, else the same
 * single-flighted disk re-open `getSessionMessages` uses (restart survival).
 *
 * Returns **`false` only when the id names no transcript in this cwd** — the chat is genuinely gone, the
 * one case a caller may recover from by starting a new one. Every other failure (runtime, provider,
 * corrupt transcript) **throws**: a caller that treated those as "not there" would silently fork a
 * conversation that is merely unreadable right now.
 */
async function ensureSessionAttachedInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<boolean> {
	if (isSessionDeleted(sessionId, workspaceId)) return false;
	// Scope to the requested workspace (like `getSessionMessages`): a live session registered under a
	// different workspace must not be promptable through this one — a caller could otherwise route a
	// review package (and its source fragments) into an unrelated chat and pin comments to it.
	const live = sessions.get(sessionId);
	if (live) {
		if (live.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
		return true;
	}
	const known = (await listSessionInfosStrict(cwd)).some(
		(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
	);
	if (!known) return false;
	await attachDiskSession(sessionId, workspaceId, cwd);
	// Attached-but-not-registered is not "absent": reporting it as such is exactly the silent fork this
	// function exists to prevent, so it surfaces as the failure it is.
	if (!sessions.has(sessionId))
		throw new Error(`Session ${sessionId} was re-opened but did not register.`);
	return true;
}

export function ensureSessionAttached(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<boolean> {
	return ensureSessionAttachedInternal(sessionId, workspaceId, cwd);
}

/**
 * A session's transcript (the roles `isTranscriptMessageRole` admits) + its current summary. Re-opens
 * the session from disk first if it isn't live, so a reopened chat is continuable and its summary accurate.
 */
async function getSessionMessagesInternal(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
	let entry = sessions.get(sessionId);
	// Scope the read to the requested workspace — a client can't pull a session from a different one.
	if (entry && entry.workspaceId !== workspaceId) throw new Error(`Unknown session: ${sessionId}`);
	if (!entry) {
		await attachDiskSession(sessionId, workspaceId, cwd);
		if (isSessionDeleted(sessionId, workspaceId)) throw new Error(`Unknown session: ${sessionId}`);
		entry = sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	}
	// Which roles travel is the wire's policy, not this function's: `history`'s search index counts
	// positions by the same guard, and a set restated here could drift from it by one role and shift every
	// later jump anchor (see `isTranscriptMessageRole`). `custom` carries the ask-user-answers pairing;
	// `compactionSummary` is pi's durable marker for what compaction summarized away.
	const messages = entry.session.messages.filter((m) =>
		isTranscriptMessageRole(m.role),
	) as TranscriptMessage[];
	return { summary: summaryOf(sessionId, entry), messages };
}

export function getSessionMessages(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	return getSessionMessagesInternal(sessionId, workspaceId, cwd);
}

/**
 * Deliver the browser's `ask_user_question` reply: vet it against the transcript (pure
 * `assessAnswerability` — unknown/answered/superseded calls fail loud instead of parking an answer),
 * then send the `ask-user-answers` custom message. `sendCustomMessage` starts a new turn when the
 * session is idle (the normal ack+terminate case — also right after a restart re-open) and steers the
 * current one when it is streaming (a fast submit while the ask turn is still winding down), so
 * answering live and answering after a restart are the same code path. Resolves at turn end — the WS
 * handler acks acceptance via `ackSend`, mirroring prompt/steer/followUp.
 */
export async function answerQuestion(
	sessionId: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): Promise<void> {
	const session = mustGet(sessionId);
	const verdict = assessAnswerability(session.messages, toolCallId);
	if (!verdict.ok) throw new Error(`${ANSWERABILITY_ERRORS[verdict.reason]}: ${toolCallId}`);
	await session.sendCustomMessage(buildAnswersMessage(toolCallId, verdict.args, result), {
		triggerTurn: true,
	});
}

/** Send a turn. `prompt()` throws while streaming, so fall back to `steer()` then. */
export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.steer(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	return mustGet(sessionId).steer(text, images);
}

/**
 * Send a turn that must NOT interrupt one in flight: queued as a follow-up while the session streams,
 * an ordinary `prompt()` when it is idle.
 *
 * pi's `followUp()` only ENQUEUES — the queue is drained by a run that is already going, so a follow-up
 * handed to an idle session is parked with nothing to deliver it (silently, until someone prompts that
 * chat). Every caller picks `followUp` from a *belief* that the session streams: a client's belief goes
 * stale the moment the turn ends, and `review.sendBatch` follows up into the review's existing chat,
 * which is idle by construction after a re-attach. Parking there is the worst outcome of all — the
 * comments are already marked sent, so the review reads as delivered to an agent that never saw it.
 */
export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.followUp(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

/** Trigger compaction; progress/result still arrive as `compaction_*` events. */
export async function compactSession(sessionId: string, instructions?: string): Promise<void> {
	await mustGet(sessionId).compact(instructions);
}

/** Cancellation control path for a live session. */
export function abortSession(sessionId: string): Promise<void> {
	return mustGet(sessionId).abort();
}

export async function setSessionModel(sessionId: string, model: WireModel): Promise<void> {
	// Re-resolve host-side against this chat's retained generation — never a newer one, never the wire ref.
	const entry = mustGetEntry(sessionId);
	await entry.session.setModel(resolveWireModel(entry.generation.runtime, model));
}

export function setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
	mustGet(sessionId).setThinkingLevel(level);
}

/** Token/cost stats for the session (display only — `pi` owns the numbers). */
export function getSessionStats(sessionId: string): SessionStats {
	const session = mustGet(sessionId);
	const stats = session.getSessionStats();
	const contextUsage = stats.contextUsage ?? session.getContextUsage();
	return {
		sessionId: stats.sessionId,
		totalMessages: stats.totalMessages,
		tokens: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
			total: stats.tokens.total,
		},
		cost: stats.cost,
		...(contextUsage ? { contextUsage } : {}),
	};
}

// Slash commands / skills available in the session — built from the same three sources pi's own rpc mode
// uses (pi's own `modes/rpc` `get_commands`).
export function getSessionCommands(sessionId: string): SlashCommandInfo[] {
	const session = mustGet(sessionId);
	const extension = session.extensionRunner.getRegisteredCommands().map((command) => ({
		name: command.invocationName,
		source: "extension" as const,
		sourceInfo: command.sourceInfo,
		...(command.description !== undefined ? { description: command.description } : {}),
	}));
	const prompt = session.promptTemplates.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt" as const,
		sourceInfo: template.sourceInfo,
	}));
	const skill = toSkillCommands(session.resourceLoader.getSkills().skills);
	return [...extension, ...prompt, ...skill];
}

/** Models with configured auth, for the model picker (cheap win #1). Redacted to `WireModel` — the raw
 * `Model.baseUrl` carries the jbcentral proxy secret when wired, and the picker only reads id/name/provider.
 * Also fires the detached catalog refresh (issue #98): the read below is `settledAvailableModels` — pi's
 * last settled snapshot, so it truly never awaits the network — and a later `model.list` picks up whatever
 * the refresh landed. */
export async function listAvailableModels(): Promise<WireModel[]> {
	const runtime = await getPiRuntime();
	void refreshCatalogs(runtime);
	return readAvailableWireModels(runtime);
}

/** `model.refresh` (the picker's freshness affordance): AWAIT the catalog refresh, then serve the
 * post-refresh snapshot. Same redaction, same universe as `listAvailableModels`; refresh failures
 * resolve (logged in piRuntime), so the caller always gets the registry's current truth. `force`
 * bypasses pi's freshness throttle — pass it for a user-initiated refresh, omit it for an implicit
 * one, which then shares the single-flight slot with any in-flight detached trigger.
 *
 * **`complete`** travels with the list because the wait is capped: it says whether the pass this call
 * awaited actually settled. Only a `true` makes the list the host's verdict — the client keys catalog
 * authority (`modelsFresh`, hence whether a missing model may be declared gone) on exactly this. */
export async function refreshAvailableModels(force = false): Promise<RefreshedModels> {
	const runtime = await getPiRuntime();
	const { completed } = await refreshCatalogs(runtime, { force });
	return { models: readAvailableWireModels(runtime), complete: completed };
}

/** The one snapshot→wire read both list paths share (redaction happens here, in `toWireModel`). */
function readAvailableWireModels(runtime: Awaited<ReturnType<typeof getPiRuntime>>): WireModel[] {
	return settledAvailableModels(runtime).map((m) => toWireModel(m as unknown as Model<string>));
}

/** The model + thinking level a new session resolves to (settings default if available, else first available). */
export interface DefaultModelResult {
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

/**
 * pi's own clamp for a `{model, desired-level}` pair — `model.clampThinking`. The pre-session picker has
 * no session to ask, so without this it would need a policy of its own, and that path would then adjust
 * effort differently from `model.default` (which clamps just below) and from a live session (which gets
 * pi's answer via `thinking_level_changed`). Re-resolves the ref host-side like every other inbound
 * model ref, so an unavailable one throws rather than being guessed at.
 */
export async function clampThinkingForModel(
	ref: Pick<WireModel, "provider" | "id">,
	level: ThinkingLevel,
): Promise<ThinkingLevel> {
	const generation = await getPiRuntimeGeneration();
	return clampThinkingLevel(resolveWireModel(generation.runtime, ref), level);
}

/**
 * The default the *next* session would start with — so the New-Workspace dialog can show the exact model
 * pre-session (not a "Default" placeholder). Mirrors pi's resolution for a fresh session: the settings
 * default (if it's available), else the first available model. Passing it back to `session.create` is a
 * no-op vs. omitting it, so an `@agent` test that doesn't touch the picker still lands on the pinned model.
 *
 * The result is **self-consistent**: the settings' thinking level is clamped (pi's own
 * `clampThinkingLevel`) onto the resolved model's supported set, so the dialog never shows a level the
 * model can't do as selected (e.g. a `high` saved from a reasoning model while the default is a
 * non-reasoning one — pi would silently clamp the created session to `off` otherwise).
 */
export async function getDefaultModel(): Promise<DefaultModelResult> {
	const available = settledAvailableModels(await getPiRuntime());
	const settings = SettingsManager.create(process.cwd());
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const pinned =
		provider && modelId
			? available.find((model) => model.provider === provider && model.id === modelId)
			: undefined;
	const resolved = (pinned ?? available[0] ?? null) as Model<string> | null;
	const saved = settings.getDefaultThinkingLevel() ?? "medium";
	const thinkingLevel = resolved ? clampThinkingLevel(resolved, saved) : saved;
	return { model: resolved ? toWireModel(resolved) : null, thinkingLevel };
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

function disposeSession(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (!entry) return;
	cancelExtUiForSession(sessionId);
	entry.unsubscribe();
	entry.session.dispose();
	sessions.delete(sessionId);
}

/** Remove one session: stop forwarding its events, settle any open dialog, and dispose it. */
export function removeSession(sessionId: string): void {
	// `session.dispose` is a live-session command too. Letting it race a pending recoverable delete would
	// leave no runtime to retain if the OS-trash operation fails.
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	disposeSession(sessionId);
}

/** Dispose every session — called on host shutdown. */
export function disposeAllSessions(): void {
	for (const [sessionId, entry] of sessions) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		entry.session.dispose();
	}
	sessions.clear();
	deletedSessions.clear();
}

/**
 * The polite half of shutdown: abort every streaming session and give pi a bounded window to settle —
 * pi's abort path writes "Operation aborted" tool results through the normal loop, so transcripts land
 * on disk already paired (no repair needed on the next boot). Bounded because shutdown must not hang on
 * a wedged provider: whatever doesn't settle inside `timeoutMs` is left to the restart repair
 * (`sessionRepair`). Callers dispose afterwards (`disposeAllSessions` via `server.stop()`).
 */
export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	const streaming = [...sessions.values()].filter((entry) => entry.session.isStreaming);
	if (streaming.length === 0) return;
	await Promise.race([
		Promise.allSettled(streaming.map((entry) => entry.session.abort())),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

/**
 * Tear down a workspace's chat sessions when it's **archived**: abort any in-flight turn, then
 * `removeSession` (unsubscribe + settle dialogs + dispose) every live session for the workspace, then
 * delete pi's on-disk transcripts rooted at the worktree `cwd`. The host calls this before removing the
 * worktree so no session — in memory or on disk — outlives it. `cwd` is optional: on a double-archive the
 * record is already gone, so we still reap any lingering live sessions and just skip the disk purge.
 */
async function removeWorkspaceSessionsInternal(workspaceId: string, cwd?: string): Promise<void> {
	const ids = [...sessions]
		.filter(([, entry]) => entry.workspaceId === workspaceId)
		.map(([sessionId]) => sessionId);
	for (const sessionId of ids) {
		const entry = sessions.get(sessionId);
		if (!entry) continue;
		// Abort a streaming turn before disposing — a mid-stream dispose drops it less cleanly.
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		// Archival tears down the whole workspace, so it must dispose unconditionally — never via the
		// guarded `removeSession`, which rejects a chat whose recoverable delete is mid-trash and would
		// abort this loop, stranding its siblings and the disk purge below.
		disposeSession(sessionId);
	}
	if (cwd) await purgeDiskSessions(cwd);
}

export function removeWorkspaceSessions(workspaceId: string, cwd?: string): Promise<void> {
	return removeWorkspaceSessionsInternal(workspaceId, cwd);
}

/**
 * Delete pi's persisted session files for a worktree `cwd`. Mirrors `listSessions`' disambiguation: pi's
 * cwd→dir encoding can alias distinct cwds to one dir, so delete only the files whose recorded `cwd` is
 * exactly this one — never `rm -rf` the encoded dir.
 */
async function purgeDiskSessions(cwd: string): Promise<void> {
	let infos: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		infos = await SessionManager.list(cwd);
	} catch {
		return; // no sessions dir for this cwd yet
	}
	for (const info of infos) {
		if (info.cwd === cwd) rmSync(info.path, { force: true });
	}
}

/**
 * Delete ONE chat for good (the history/closed-chats list's trash action): abort it if streaming, move its
 * transcript to the OS trash, then dispose its live runtime only after that recoverable deletion boundary
 * succeeds. The chat is usually a CLOSED one, so the file is resolved from disk
 * with the same cwd+id disambiguation `getSessionMessages` uses — and only a file whose recorded `cwd`
 * matches this workspace is touched, so a stray/foreign id disposes nothing and trashes nothing.
 *
 * **Single-flighted per session id.** Concurrent trash clicks on one chat must not run rival transactions:
 * two owners of the shared tombstone would let the loser's failure roll it back while the winner's move is
 * still pending, briefly re-opening the chat to new turns. A duplicate call for the same id joins the
 * running transaction (same workspace) or is rejected as unknown (a foreign workspace naming this id).
 */
export function deleteSession(sessionId: string, workspaceId: string, cwd: string): Promise<void> {
	const inFlight = deletingSessions.get(sessionId);
	if (inFlight) {
		// A session id belongs to exactly one workspace; a different one naming it isn't this client's chat.
		if (inFlight.workspaceId !== workspaceId)
			return Promise.reject(new Error(`Unknown session: ${sessionId}`));
		return inFlight.done;
	}

	// `runDeleteTransaction` installs the tombstone synchronously (before its first await), so the entry is
	// registered here before the promise suspends and any concurrent caller can only observe it in flight.
	const transaction = runDeleteTransaction(sessionId, workspaceId, cwd);
	const done = transaction.then(
		() => {
			deletingSessions.delete(sessionId);
		},
		(error: unknown) => {
			deletingSessions.delete(sessionId);
			throw error;
		},
	);
	deletingSessions.set(sessionId, { workspaceId, done });
	return done;
}

async function runDeleteTransaction(
	sessionId: string,
	workspaceId: string,
	cwd: string,
): Promise<void> {
	// Win before any await: a disk re-open already in flight will see this before it can register, and a
	// later one is rejected at its entry point. Only clear on failure what THIS transaction installed — a
	// pre-existing tombstone from an earlier successful deletion must survive a later spurious re-delete.
	const installedTombstone = !deletedSessions.has(sessionId);
	deletedSessions.set(sessionId, workspaceId);
	let liveEntry: Entry | undefined;
	try {
		await attaching.get(sessionId)?.catch(() => {});
		const entry = sessions.get(sessionId);
		if (entry && entry.workspaceId !== workspaceId) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		let path: string | undefined;
		if (entry) {
			liveEntry = entry;
			// Stop any writer before moving its transcript, but keep the entry registered until that move
			// succeeds. A trash failure must leave the client-visible runtime addressable, not half-deleted.
			if (entry.session.isStreaming) await entry.session.abort();
			const manager = entry.session.sessionManager;
			if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
				throw new Error(`Session transcript scope mismatch: ${sessionId}`);
			}
			// A live manager is the authority on its exact file — never rediscover it through pi's lossy list.
			path = manager.getSessionFile();
			if (manager.isPersisted() && !path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
		} else {
			path = (await listSessionInfosStrict(cwd)).find(
				(candidate) => candidate.id === sessionId && candidate.cwd === cwd,
			)?.path;
		}
		// A new empty chat's reserved JSONL path may not exist yet — nothing recoverable to move.
		if (path && existsSync(path)) await trashFile(path);
	} catch (error) {
		// The deletion boundary did not complete: retain any live entry, allow disk re-attach/retry, and
		// publish nothing. The client that received the failure still has a usable chat runtime. Single-flight
		// makes this the sole owner, so it clears only the tombstone it just installed.
		if (installedTombstone) deletedSessions.delete(sessionId);
		throw error;
	}
	// Only disposal after the recoverable disk move is committed. If another path already removed this
	// exact entry, disposal is an idempotent no-op; never dispose a replacement entry by mistake.
	if (liveEntry && sessions.get(sessionId) === liveEntry) disposeSession(sessionId);
	publishDeleted({ workspaceId, sessionId });
}
