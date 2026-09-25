import type { ResourceContextInput } from "pi-delegation";
import type { DagResult } from "./errors.ts";
import type {
	ActivationRef,
	DagCommandRequest,
	DagConnection,
	DagNodeSpec,
	GateAuthority,
	PageRequest,
} from "./schemas.ts";

import type {
	ConsumedInput,
	DagCaller,
	DagNotice,
	DagReceipt,
	DecisionRecord,
	Gate,
	Intervention,
	Proposal,
	StoredFile,
	StoredOutcome,
	StoredValue,
} from "./serialization.ts";
export interface CapturedFileRef extends StoredFile {
	localPath: string;
}
export interface DagHistoryCaptureRef extends CapturedFileRef {
	sourceSessionId: string;
	entryId: string | null;
}
export interface CapturedText {
	preview: string;
	file: CapturedFileRef;
}
export interface DagValueRead extends Omit<StoredValue, "file"> {
	file: CapturedFileRef;
}
export interface DagRef {
	dagId: string;
}
export interface OutputRequest extends DagRef {
	proposalId: string;
	name: string;
}
export interface DagPageRequest extends PageRequest, DagRef {}
export interface Page<T> {
	items: T[];
	nextCursor?: string;
	version?: number;
}
export type DagNodeStatus =
	| "pending"
	| "queued"
	| "running"
	| "waiting-input"
	| "waiting-approval"
	| "needs-attention"
	| "interrupted"
	| "uncertain"
	| "stale"
	| "completed"
	| "cancelled"
	| "skipped";
export interface DagSummary {
	dagId: string;
	title: string;
	version: number;
	graphRevision: number;
	mode: "paused" | "running";
	lifecycle: "active" | "disposing" | "disposed";
	createdAt: string;
	updatedAt: string;
}
export type DagOutcomeRead = Omit<StoredOutcome, "finalText" | "errorMessage"> & {
	finalText?: CapturedFileRef;
	errorMessage?: CapturedFileRef;
};
export interface DagNodeRead {
	id: string;
	task: CapturedText;
	inputs: DagNodeSpec["inputs"];
	outputs: DagNodeSpec["outputs"];
	status: DagNodeStatus;
	held: boolean;
	cancelled: boolean;
	configuration?: CapturedFileRef;
	payload?: CapturedFileRef;
	consumedInputs: Array<Omit<ConsumedInput, "value"> & { value: DagValueRead }>;
	historyCapture?: DagHistoryCaptureRef;
	exportedHistory?: { capture: DagHistoryCaptureRef; released: boolean };
	acceptance?: DecisionRecord;
	attempt?: number;
	activation?: number;
	sessionId?: string;
	proposalId?: string;
	gateId?: string;
	outcome?: DagOutcomeRead;
	failure?: CapturedFileRef;
}
export interface DagGateRead {
	id: string;
	disposition: Gate["disposition"];
	decision?: DecisionRecord;
	answer?: CapturedFileRef;
	kind: "approval" | "input";
	target: ActivationRef;
	authority: GateAuthority;
	question: CapturedText;
	proposalId?: string;
	historyCapture?: DagHistoryCaptureRef;
}
export interface DagSnapshot extends DagSummary {
	executionOwner: "local" | "other" | "none";
	definition: CapturedFileRef;
	nodes: DagNodeRead[];
	connections: DagConnection[];
	gates: DagGateRead[];
	mainHistory?: DagHistoryCaptureRef;
	interventions: Array<{
		commandId: string;
		target: ActivationRef;
		status: Intervention["status"];
	}>;
}
export interface DagOutputRead {
	proposalId: string;
	target: ActivationRef;
	name: string;
	value: DagValueRead;
	disposition: Proposal["disposition"];
	acceptance?: DecisionRecord;
}
export interface DagHistoryEntry {
	id: string;
	version: number;
	at: string;
	kind: string;
	actor?: DagCaller;
	target?: ActivationRef;
	content: CapturedFileRef;
	files: CapturedFileRef[];
}
export interface DagNoticeSink {
	tryDeliver(notice: DagNotice): "submitted" | "deferred";
	onReady(listener: () => void): () => void;
}
export interface DagCallerBinding {
	caller: DagCaller;
	signal: AbortSignal;
	execution?: ResourceContextInput;
	mainHistory?: Extract<import("pi-delegation").HistoryCaptureSource, { kind: "session" }>;
	notices?: DagNoticeSink;
}
export interface DagClient {
	execute(request: DagCommandRequest): Promise<DagResult<DagReceipt>>;
	listDags(request?: PageRequest): Promise<DagResult<Page<DagSummary>>>;
	getDag(request: DagRef): Promise<DagResult<DagSnapshot>>;
	getOutput(request: OutputRequest): Promise<DagResult<DagOutputRead>>;
	listHistory(request: DagPageRequest): Promise<DagResult<Page<DagHistoryEntry>>>;
}
export interface DagService {
	bind(binding: DagCallerBinding): DagClient;
	close(): Promise<void>;
}
