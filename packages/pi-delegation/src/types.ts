// The delegation contract — the framework for creating agent sessions *from* agent sessions.
// Design + decision log: this package's SPEC.md (spec leads code). V1 implements exactly
// one axis combination (hidden, non-interactive, fresh); every other combination is typed here and
// rejected loudly (`DelegationError` code "not-implemented") until its consumer lands.

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
	ExtensionContext,
	ExtensionFactory,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";

/** Terminal status of one run — expected outcomes are values, not rejections. */
export type RunStatus = "completed" | "error" | "aborted";

/** Registry status of the latest run of a child (queued/running before a terminal status lands). */
export type RunLifecycleStatus = "queued" | "running" | RunStatus;

/**
 * Descriptive metadata — recorded in lineage (`SpawnRecord.info`), stamped into
 * `DelegationRunDetails`; ZERO behavioral effect (behavior travels exclusively in `session`).
 * All strings are open sets by convention — new consumers add values, never contract changes.
 */
export interface ChildInfo {
	/** Provenance: `"tool:Agent"` | `"user"` | `"workflow:<name>"` | … */
	createdBy: string;
	/** Display label. */
	roleName?: string;
	/** e.g. `"builtin"` — the core never learns the definition taxonomy. */
	roleSource?: string;
}

/**
 * pi's names, pi's semantics (a mirrored subset of `createAgentSession`'s signature) — a pi user
 * recognizes every field. The INFRASTRUCTURE options are deliberately NOT mirrored: modelRuntime,
 * sessionManager, settingsManager, resourceLoader, customTools are assembled by the core (shared
 * runtime, hidden session dir, gated loaders) — exposing them would let a consumer bypass
 * storage/lineage/trust.
 */
export interface SessionOptions {
	/**
	 * Exact model ref, resolved against the runtime's registry. Default: parent's current model.
	 * Fuzzy resolution is the consumer's job; an unknown exact ref throws a plain `Error` (not a
	 * `DelegationError` — the typed codes are reserved for axis/lifecycle misuse).
	 */
	model?: { provider: string; id: string };
	/** Default: parent's current level. */
	thinkingLevel?: ThinkingLevel;
	/** pi allowlist semantics. */
	tools?: string[];
	/** pi denylist semantics — survives registry rebuilds. */
	excludeTools?: string[];
	/** → `systemPromptOverride` (the consumer assembles body + bridge + env). */
	systemPrompt?: string;
	/** Default false — worktree AGENTS.md opt-in. */
	contextFiles?: boolean;
	/** Explicit skill selection, default none. */
	skills?: string[];
	/**
	 * Default false — opt into the EMBEDDER-BOUND child extension set
	 * (`DelegationBindings.childExtensionFactories`), never pi disk discovery (decision #25). The
	 * `tools` allowlist gates which of the set's tools are actually callable.
	 */
	extensions?: boolean;
}

/**
 * The isolation seam — generative: a provider returns a value the core consumes at run start.
 * "Where does a child run and what brackets the run" is a strategy (git worktree, tmpdir,
 * container, remote sandbox), never core behavior; the core consumes only a cwd + teardown hook.
 */
export interface WorkspaceProvider {
	prepare(ctx: {
		sessionId: string;
		parentSessionId: string;
		baseCwd: string;
		roleName?: string;
	}): Promise<{
		cwd: string;
		dispose(outcome: { status: RunStatus }): { resultAddendum?: string } | undefined;
	}>;
}

/** Phase 1: creation — identity + shape, ZERO run concerns. */
export interface CreateChildSpec {
	/**
	 * Parent sessionId — cwd and model/thinking defaults are DERIVED from the live parent, resolved
	 * via the embedder's parent binding (inconsistent triples unrepresentable; unknown parent →
	 * typed error).
	 */
	parent: string;
	/** Descriptive metadata — never behavior. */
	info: ChildInfo;
	/** Default `{ kind: "fresh" }`; `fork` and `seeded` are rejected in V1. */
	origin?:
		| { kind: "fresh" }
		| { kind: "fork"; sourceSessionId: string; entryId?: string }
		| { kind: "seeded"; digest: string };
	/** REQUIRED, no default; `"listed"` rejected in V1. */
	visibility: "hidden" | "listed";
	/** Default false; true rejected in V1 (until subsessions). */
	interactive?: boolean;
	/** Absent = shared parent cwd; the isolation seam. */
	workspace?: WorkspaceProvider;
	/** pi-mirrored subset; absent = parent-like — rejected in V1 (no consumer). */
	session?: SessionOptions;
}

export interface RunOptions {
	/**
	 * Run governance — NOT in `SessionOptions` (pi has no such option; the mirror stays pure) and
	 * per-RUN (a chain reuses a child with different caps). On cap: steer a wrap-up instruction,
	 * then abort if the run outlives the wrap-up turn.
	 */
	maxTurns?: number;
	/** Caller cancellation (tool signal, engine fail-fast). */
	signal?: AbortSignal;
	/** REPLACE-style snapshots → `partialResult`. */
	onUpdate?: (details: DelegationRunDetails) => void;
}

/**
 * Expected outcomes are VALUES — the run methods resolve with status even for error/aborted
 * (cards need the details); they REJECT only on contract misuse, with a typed error.
 */
export interface RunOutcome {
	status: RunStatus;
	/** Last assistant text. */
	finalText?: string;
	/** Final snapshot (usage, duration — pi-owned numbers). */
	details: DelegationRunDetails;
	errorMessage?: string;
}

/** Lineage — the persisted edge (V1: derived from the storage layout — SPEC.md, Storage & lineage). */
export interface SpawnRecord {
	sessionId: string;
	parentSessionId: string;
	/** Storage partition key — bound by the embedder (ThinkRail: workspaceId; pure pi: "default"). */
	scope: string;
	originKind: "fresh" | "fork" | "seeded";
	entryId?: string;
	info: ChildInfo;
	interactive: boolean;
	visibility: "hidden" | "listed";
	createdAt: string;
	sessionFile: string;
}

/**
 * Registry projection (in-memory, keyed by parent sessionId): the LATEST run per child.
 * Multi-run bookkeeping (workflow chains running a child sequentially) is the caller's.
 */
export interface RunSnapshot {
	status: RunLifecycleStatus;
	task: string;
	details: DelegationRunDetails;
	finalText?: string;
	/** An errored run keeps its reason for later collection (decision #24). */
	errorMessage?: string;
	/** A detached (unawaited) run's result was collected (`ChildHandle.collectResult`). */
	collected: boolean;
}

/**
 * Wire/renderer contract — authored here, MIRRORED into `@thinkrail/contracts` (never imported):
 * the package and the wire stay structurally identical; the web reads the mirror.
 */
export interface DelegationRunDetails {
	/** THE id on the wire. */
	childSessionId: string;
	roleName?: string;
	roleSource?: string;
	task: string;
	status: RunLifecycleStatus;
	/** `"<provider>/<id>"`. */
	model?: string;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		turns: number;
		contextTokens: number;
	};
	durationMs: number;
	/** Last tool/step line — the live card. */
	activity?: string;
}

export type LifecycleEvent =
	| { type: "child-created"; record: SpawnRecord }
	| { type: "run-queued" | "run-started"; sessionId: string; parentSessionId: string }
	| { type: "run-terminal"; sessionId: string; parentSessionId: string; outcome: RunOutcome }
	| { type: "child-disposed"; sessionId: string; parentSessionId: string };

export type DelegationErrorCode =
	/** V1-rejected axis combination. */
	| "not-implemented"
	/** Permanently invalid (hidden+interactive; a run method on an interactive child). */
	| "invalid-combination"
	/** Parent not resolvable via the embedder's parent binding. */
	| "unknown-parent"
	/** One run at a time per child — steer instead. */
	| "already-running"
	| "disposed";

/** Contract-misuse rejections — never used for expected run failures (those are outcome values). */
export class DelegationError extends Error {
	readonly code: DelegationErrorCode;

	constructor(code: DelegationErrorCode, message: string) {
		super(message);
		this.name = "DelegationError";
		this.code = code;
	}
}

/** Phase 2: the handle — the ONLY way to drive a child (raw `AgentSession` never exposed). */
export interface ChildHandle {
	/** The child `AgentSession` id — THE id, everywhere. */
	readonly sessionId: string;
	readonly record: SpawnRecord;
	/** Latest run (registry projection), or undefined before the first run. */
	readonly snapshot: RunSnapshot | undefined;
	/** Waits for a per-parent slot. */
	runQueued(task: string, opts?: RunOptions): Promise<RunOutcome>;
	/** Bypasses the queue — loud-rejected in V1 (no consumer). */
	runNow(task: string, opts?: RunOptions): Promise<RunOutcome>;
	/** While running (turn-cap wrap-up uses this internally). */
	steer(text: string): Promise<void>;
	/** Abort the current run. */
	abort(): Promise<void>;
	/** Abort + workspace dispose + release. */
	dispose(): Promise<void>;
	/** Lifecycle events for this child only. */
	onEvent(l: (e: LifecycleEvent) => void): () => void;
	/** The latest snapshot; a terminal one is marked `collected` by this read. */
	collectResult(): RunSnapshot | undefined;
}

/** The service (= the barrel). */
export interface DelegationService {
	createChild(spec: CreateChildSpec): Promise<ChildHandle>;
	/** By CHILD id — "find" = may be absent. */
	findChild(sessionId: string): ChildHandle | undefined;
	/** By PARENT id — the key is in the name. */
	childrenOf(parentSessionId: string): ChildHandle[];
	/** The workflow extension point. */
	onLifecycle(l: (e: LifecycleEvent) => void): () => void;
	/** The cascade — the embedder calls it when a parent is disposed. */
	disposeChildrenOf(parentSessionId: string): Promise<void>;
}

/**
 * What the core reads off a live parent — cwd (the child's default workspace), current model, and
 * thinking level. Reuses pi's own `ExtensionContext` shape, so in pure pi the consuming extension's
 * `ctx` satisfies it structurally (pi never hands extensions the raw `AgentSession`); ThinkRail
 * projects it off the manager's live session.
 */
export type ParentContext = Pick<ExtensionContext, "cwd" | "model" | "thinkingLevel">;

/**
 * Embedder bindings — everything host-specific enters here. `delegationRoot`/`scope` default for
 * pure pi; `resolveParent` cannot default inside the library (in pure pi the pi-subagents extension
 * projects its own ctx; in ThinkRail the manager supplies the lookup).
 */
export interface DelegationBindings {
	/** Live-parent projection — `undefined` = not live (→ the typed `unknown-parent` error). */
	resolveParent: (sessionId: string) => ParentContext | undefined;
	/** Storage root — ThinkRail: `~/.thinkrail/delegation`; default: `<piAgentDir>/delegation`. */
	delegationRoot?: string;
	/** Storage partition key — ThinkRail: workspaceId; default: `"default"`. */
	scope?: string;
	/** Shared model/auth runtime — ThinkRail passes its host runtime; default: pi's own. */
	modelRuntime?: ModelRuntime;
	/** Concurrency slots per parent session (resource governance, not correctness). Default 4. */
	maxConcurrentPerParent?: number;
	/**
	 * The curated extension set a child MAY load (`SessionOptions.extensions: true` opts a child
	 * in). Hidden children never run pi disk discovery — blanket inheritance is the documented
	 * failure class (interactive tools hang a non-interactive child; heavy extensions multiply per
	 * child). Default: none — the opt-in is inert under a zero-config embedding (decision #25).
	 */
	childExtensionFactories?: ExtensionFactory[];
}
