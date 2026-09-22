import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import {
	canonicalJson,
	type DagNotice,
	type DagSnapshot,
	type DagState,
	type DagSummary,
	endpoints,
	fail,
	findCurrentTarget,
	LIMITS,
	latest,
	nodeStatus,
	type Page,
	type PageRequest,
	PageSchema,
} from "../domain";
import type { DagStore } from "../persistence";

export function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
export function summary(state: DagSummary): DagSummary {
	const { dagId, title, version, graphRevision, mode, lifecycle, createdAt, updatedAt } = state;
	return { dagId, title, version, graphRevision, mode, lifecycle, createdAt, updatedAt };
}
export function recover(state: DagState): boolean {
	let changed = state.mode !== "paused";
	state.mode = "paused";
	for (const node of Object.values(state.nodes)) {
		const current = latest(node);
		if (current && ["preparing", "queued", "running"].includes(current.activation.phase)) {
			current.activation.phase = "uncertain";
			node.held = true;
			changed = true;
		}
	}
	return changed;
}
export function snapshot(
	store: DagStore,
	state: DagState,
	executionOwner: DagSnapshot["executionOwner"],
): DagSnapshot {
	const ref = (file: Parameters<DagStore["reference"]>[1]) => store.reference(state.dagId, file);
	const captureRef = (id: string | undefined) => {
		const capture = id ? state.captures[id] : undefined;
		return capture
			? { ...ref(capture.file), sourceSessionId: capture.sourceSessionId, entryId: capture.entryId }
			: undefined;
	};
	const mainHistory = captureRef(state.mainHistoryId);
	return {
		...summary(state),
		executionOwner,
		definition: ref(state.definitionFile),
		nodes: state.definitionValue.nodes.map((spec) => {
			const node = state.nodes[spec.id];
			if (!node) return fail("corrupt-state", "Missing current node");
			const current = latest(node);
			const outcome = current?.activation.outcome;
			const historyCapture = captureRef(current?.attempt.historyCaptureId);
			const proposal = current?.activation.proposalId
				? state.proposals[current.activation.proposalId]
				: undefined;
			const exportedHistory = captureRef(proposal?.historyCaptureId);
			const { finalText, errorMessage, ...evidence } = outcome ?? {};
			const publicOutcome = outcome
				? {
						...evidence,
						status: outcome.status,
						details: outcome.details,
						historyEntryId: outcome.historyEntryId,
						...(finalText ? { finalText: ref(finalText) } : {}),
						...(errorMessage ? { errorMessage: ref(errorMessage) } : {}),
					}
				: undefined;
			return {
				id: spec.id,
				task: { preview: spec.task.slice(0, LIMITS.preview), file: ref(node.taskFile) },
				inputs: spec.inputs,
				outputs: spec.outputs,
				status: nodeStatus(state, spec.id),
				held: node.held,
				cancelled: node.cancelled,
				consumedInputs:
					current?.attempt.inputs.map((input) => ({
						...input,
						value: { ...input.value, file: ref(input.value.file) },
					})) ?? [],
				...(current
					? {
							configuration: ref(current.attempt.configuration),
							payload: ref(current.activation.payload),
						}
					: {}),
				...(historyCapture ? { historyCapture } : {}),
				...(exportedHistory
					? { exportedHistory: { capture: exportedHistory, released: !!proposal?.historyRelease } }
					: {}),
				...(proposal?.acceptance ? { acceptance: proposal.acceptance } : {}),
				...(current
					? { attempt: current.attempt.number, activation: current.activation.number }
					: {}),
				...(current?.attempt.birth ? { sessionId: current.attempt.birth.sessionId } : {}),
				...(current?.activation.proposalId ? { proposalId: current.activation.proposalId } : {}),
				...(current?.activation.gateId ? { gateId: current.activation.gateId } : {}),
				...(current?.activation.failure ? { failure: ref(current.activation.failure) } : {}),
				...(publicOutcome ? { outcome: publicOutcome } : {}),
			};
		}),
		connections: structuredClone(state.definitionValue.connections),
		gates: Object.values(state.gates)
			.filter((gate) => {
				const current = findCurrentTarget(state, gate.target);
				return current && !current.attempt.stale;
			})
			.map((gate) => {
				const capture = captureRef(gate.historyCaptureId);
				return {
					id: gate.id,
					kind: gate.kind,
					disposition: gate.disposition,
					...(gate.decision ? { decision: gate.decision } : {}),
					...(gate.answer ? { answer: ref(gate.answer) } : {}),
					target: { ...gate.target },
					authority: gate.authority,
					question: { preview: gate.questionPreview, file: ref(gate.question) },
					...(gate.proposalId ? { proposalId: gate.proposalId } : {}),
					...(capture ? { historyCapture: capture } : {}),
				};
			}),
		...(mainHistory ? { mainHistory } : {}),
		interventions: state.interventions
			.filter((item) => item.status !== "settled" && item.status !== "superseded")
			.map((item) => ({
				commandId: item.commandId,
				target: { ...item.target },
				status: item.status,
			})),
	};
}
export function relevantNotice(state: DagState, notice: DagNotice): boolean {
	if (notice.kind === "disposed") return state.lifecycle === "disposed";
	if (state.lifecycle !== "active") return false;
	if (notice.kind === "recovery")
		return (
			state.mode === "paused" &&
			(Object.values(state.nodes).some((node) => latest(node)?.activation.phase === "uncertain") ||
				state.interventions.some((item) => item.status === "pending"))
		);
	const target = notice.target;
	const current = target ? findCurrentTarget(state, target) : undefined;
	if (!current || current.attempt.stale) return false;
	const { node } = current;
	if (notice.kind === "waiting")
		return !!notice.gateId && state.gates[notice.gateId]?.disposition === "pending";
	const status = nodeStatus(state, node.id);
	if (notice.kind === "completed")
		return status === "completed" && current.activation.proposalId === notice.proposalId;
	const proposal = current.activation.proposalId
		? state.proposals[current.activation.proposalId]
		: undefined;
	return (
		status === "needs-attention" ||
		status === "uncertain" ||
		(!!current.activation.failure &&
			!proposal?.historyCaptureId &&
			state.definitionValue.connections.some(
				(connection) => connection.context === "fork" && endpoints(connection).from === node.id,
			))
	);
}
export function page<T>(
	items: T[],
	request: PageRequest,
	identity: string,
	version: number | string,
): Page<T> {
	if (!Check(PageSchema, request)) fail("invalid-command", "Invalid page request");
	let offset = 0;
	if (request.cursor) {
		let value: unknown;
		try {
			value = JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8"));
		} catch {
			fail("cursor-expired", "Invalid page cursor");
		}
		if (
			typeof value !== "object" ||
			value === null ||
			!("identity" in value) ||
			value.identity !== identity ||
			!("version" in value) ||
			value.version !== version ||
			!("offset" in value) ||
			typeof value.offset !== "number" ||
			!Number.isSafeInteger(value.offset) ||
			value.offset < 0 ||
			value.offset > items.length
		)
			fail("cursor-expired", "The page snapshot changed; restart pagination");
		offset = value.offset;
	}
	const limit = request.limit ?? 20;
	const next = offset + limit;
	return {
		items: items.slice(offset, next),
		...(typeof version === "number" ? { version } : {}),
		...(next < items.length
			? {
					nextCursor: Buffer.from(canonicalJson({ identity, version, offset: next })).toString(
						"base64url",
					),
				}
			: {}),
	};
}
