import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	ExtensionFactory,
	ModelRegistry,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";

export type RunStatus = "completed" | "error" | "aborted";

export type RunLifecycleStatus = "queued" | "running" | RunStatus;

export interface ChildInfo {
	createdBy: string;
	roleName?: string;
	roleSource?: string;
}

export interface SessionOptions {
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	excludeTools?: string[];
	systemPrompt?: string;
	contextFiles?: boolean;
	skills?: string[];
	extensions?: boolean;
}

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

export interface CreateChildSpec {
	parent: string;
	info: ChildInfo;
	origin?:
		| { kind: "fresh" }
		| { kind: "fork"; sourceSessionId: string; entryId?: string }
		| { kind: "fork-captured"; history: CapturedHistory }
		| { kind: "seeded"; digest: string };
	visibility: "hidden" | "listed";
	interactive?: boolean;
	workspace?: WorkspaceProvider;
	session?: SessionOptions;
}

export interface RunOptions {
	maxTurns?: number;
	signal?: AbortSignal;
	onUpdate?: (details: DelegationRunDetails) => void;
}

export interface RunOutcome {
	readonly historyEntryId: string | null;
	stopReason?: AssistantMessage["stopReason"];
	status: RunStatus;
	finalText?: string;
	details: DelegationRunDetails;
	errorMessage?: string;
}

export interface SpawnRecord {
	readonly sessionId: string;
	readonly parentSessionId: string;
	readonly scope: string;
	readonly originKind: "fresh" | "fork" | "seeded";
	readonly entryId?: string;
	readonly info: Readonly<ChildInfo>;
	readonly interactive: boolean;
	readonly visibility: "hidden" | "listed";
	readonly createdAt: string;
	readonly sessionFile: string;
}

export interface RunSnapshot {
	status: RunLifecycleStatus;
	task: string;
	details: DelegationRunDetails;
	finalText?: string;
	errorMessage?: string;
	collected: boolean;
}

export interface DelegationRunDetails {
	childSessionId: string;
	roleName?: string;
	roleSource?: string;
	task: string;
	status: RunLifecycleStatus;
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
	activity?: string;
}

export type LifecycleEvent =
	| { type: "child-created"; record: SpawnRecord }
	| { type: "run-queued" | "run-started"; sessionId: string; parentSessionId: string }
	| { type: "run-terminal"; sessionId: string; parentSessionId: string; outcome: RunOutcome }
	| { type: "child-disposed"; sessionId: string; parentSessionId: string };

export type DelegationErrorCode =
	| "not-implemented"
	| "invalid-combination"
	| "unknown-parent"
	| "already-running"
	| "disposed"
	| "resource-exists"
	| "model-unavailable"
	| "unsupported-auth"
	| "history-unavailable"
	| "invalid-history"
	| "incomplete-history"
	| "source-busy"
	| "invalid-child-record"
	| "child-transcript-unavailable"
	| "invalid-child-transcript"
	| "not-running";

export class DelegationError extends Error {
	readonly code: DelegationErrorCode;

	constructor(code: DelegationErrorCode, message: string) {
		super(message);
		this.name = "DelegationError";
		this.code = code;
	}
}

export interface ChildHandle {
	readonly sessionId: string;
	readonly record: SpawnRecord;
	readonly snapshot: RunSnapshot | undefined;
	runQueued(task: string, opts?: RunOptions): Promise<RunOutcome>;
	runNow(task: string, opts?: RunOptions): Promise<RunOutcome>;
	steer(text: string): Promise<void>;
	abort(): Promise<void>;
	dispose(): Promise<void>;
	onEvent(l: (e: LifecycleEvent) => void): () => void;
	collectResult(): RunSnapshot | undefined;
}

export interface DelegationService {
	captureHistory(source: HistoryCaptureSource): Promise<CapturedHistory>;
	registerResource(
		resourceId: string,
		context: ResourceContextInput,
		options?: ResourceDelegationOptions,
	): Promise<ResourceDelegation>;
	createChild(spec: CreateChildSpec): Promise<ChildHandle>;
	findChild(sessionId: string): ChildHandle | undefined;
	childrenOf(parentSessionId: string): ChildHandle[];
	onLifecycle(l: (e: LifecycleEvent) => void): () => void;
	disposeChildrenOf(parentSessionId: string): Promise<void>;
}

export type ParentContext = Pick<ExtensionContext, "cwd" | "model" | "thinkingLevel"> & {
	modelRuntime?: ModelRuntime;
	modelRegistry?: ExtensionContext["modelRegistry"];
};

export interface DelegationBindings {
	resolveParent?: (sessionId: string) => ParentContext | undefined;
	delegationRoot?: string;
	scope?: string;
	modelRuntime?: ModelRuntime | (() => ModelRuntime | Promise<ModelRuntime>);
	maxConcurrentPerParent?: number;
	childExtensionFactories?: ExtensionFactory[];
}

export type HistoryCaptureSource =
	| {
			kind: "session";
			sessionId: string;
			sessionManager: ExtensionContext["sessionManager"];
			cut:
				| { kind: "before-tool-call"; toolCallId: string }
				| { kind: "at-entry"; entryId: string | null };
	  }
	| { kind: "resource-child"; resourceId: string; sessionId: string; entryId: string | null };

export interface CapturedHistory {
	readonly format: "pi-session-branch-v1";
	readonly sourceSessionId: string;
	readonly entryId: string | null;
	readonly sha256: string;
	readonly sizeBytes: number;
	readonly jsonl: string;
}

export type ResourceContextInput = {
	cwd: string;
	model?: SessionOptions["model"];
	thinkingLevel?: SessionOptions["thinkingLevel"];
} & (
	| { kind: "runtime"; modelRuntime: ModelRuntime }
	| { kind: "registry"; modelRegistry: ModelRegistry }
);

export interface ResourceDelegationOptions {
	maxConcurrent?: number;
	childExtensionFactories?: ExtensionFactory[];
}

export type ResourceSpawnRecord = Omit<SpawnRecord, "parentSessionId"> & {
	readonly resourceId: string;
};
export type ResourceChildBirth = Readonly<Omit<ResourceSpawnRecord, "sessionFile">>;
export type ResourceChildHandle = Pick<
	ChildHandle,
	"sessionId" | "runQueued" | "steer" | "abort" | "dispose"
> & {
	readonly record: ResourceSpawnRecord;
};

export interface ResourceDelegation {
	validateModels(models: Array<NonNullable<SessionOptions["model"]>>): Promise<void>;
	createChild(spec: Omit<CreateChildSpec, "parent">): Promise<ResourceChildHandle>;
	reopenChild(spec: {
		birth: ResourceChildBirth;
		session: SessionOptions;
	}): Promise<ResourceChildHandle>;
	release(): Promise<void>;
}
