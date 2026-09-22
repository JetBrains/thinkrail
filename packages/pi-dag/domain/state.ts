import { canonicalJson, DagError, fail } from "./errors.ts";
import { affectedNodes, applyEdits, endpoints } from "./graph.ts";
import type { ActivationRef, DagDefinition, GateAuthority, GraphEdit } from "./schemas.ts";
import type {
	Activation,
	Attempt,
	ConsumedInput,
	DagCaller,
	DagState,
	NodeRecord,
	Proposal,
} from "./serialization.ts";
import type { DagNodeStatus } from "./types.ts";

export function latest(node: NodeRecord): { attempt: Attempt; activation: Activation } | undefined {
	const attempt = node.attempts.at(-1);
	const activation = attempt?.activations.at(-1);
	return attempt && activation ? { attempt, activation } : undefined;
}

export function findCurrentTarget(
	state: DagState,
	target: ActivationRef,
): { node: NodeRecord; attempt: Attempt; activation: Activation } | undefined {
	const node = state.nodes[target.nodeId];
	const current = node ? latest(node) : undefined;
	if (
		!node ||
		!current ||
		current.attempt.number !== target.attempt ||
		current.activation.number !== target.activation
	)
		return undefined;
	return { node, ...current };
}

export function currentTarget(state: DagState, target: ActivationRef) {
	return (
		findCurrentTarget(state, target) ??
		fail("stale-target", "The command does not target the current activation")
	);
}

export function active(node: NodeRecord): boolean {
	const phase = latest(node)?.activation.phase;
	return phase === "preparing" || phase === "queued" || phase === "running";
}

export function nodeStatus(state: DagState, nodeId: string): DagNodeStatus {
	const node = state.nodes[nodeId];
	if (!node) return "pending";
	const current = latest(node);
	if (node.retryOutputs !== undefined) return node.held ? "interrupted" : "pending";
	if (node.skipped) return "skipped";
	if (current?.attempt.stale) return "stale";
	if (current?.activation.phase === "uncertain") return "uncertain";
	if (active(node)) return current?.activation.phase === "running" ? "running" : "queued";
	if (node.cancelled) return "cancelled";
	if (!current) return node.held ? "interrupted" : "pending";
	const proposal = current.activation.proposalId
		? state.proposals[current.activation.proposalId]
		: undefined;
	if (proposal?.disposition === "accepted") return "completed";
	if (node.continuation) return "queued";
	if (node.held || current.activation.interrupted) return "interrupted";
	if (
		Object.values(state.gates).some(
			(gate) =>
				gate.target.nodeId === nodeId &&
				gate.target.attempt === current.attempt.number &&
				gate.target.activation === current.activation.number &&
				gate.disposition === "pending",
		)
	) {
		return current.activation.gateId ? "waiting-input" : "waiting-approval";
	}
	return "needs-attention";
}

export function acceptedProposal(state: DagState, nodeId: string): Proposal | undefined {
	if (nodeStatus(state, nodeId) !== "completed") return undefined;
	const node = state.nodes[nodeId];
	const id = node ? latest(node)?.activation.proposalId : undefined;
	return id ? state.proposals[id] : undefined;
}

export function readyInputs(
	state: DagState,
	nodeId: string,
): { inputs: ConsumedInput[]; historyCaptureId?: string } | undefined {
	const inputs: ConsumedInput[] = [];
	let historyCaptureId: string | undefined;
	for (const connection of state.definitionValue.connections) {
		const { from, to } = endpoints(connection);
		if (to !== nodeId) continue;
		if (from === null) {
			if (!state.mainHistoryId || !state.captures[state.mainHistoryId]) return undefined;
			historyCaptureId = state.mainHistoryId;
			continue;
		}
		if (
			connection.kind === "control" &&
			"allowSkipped" in connection &&
			connection.allowSkipped &&
			!connection.context &&
			nodeStatus(state, from) === "skipped"
		)
			continue;
		const proposal = acceptedProposal(state, from);
		if (!proposal) return undefined;
		if (connection.context === "fork") {
			if (
				!proposal.historyRelease ||
				!proposal.historyCaptureId ||
				!state.captures[proposal.historyCaptureId]
			)
				return undefined;
			historyCaptureId = proposal.historyCaptureId;
		}
		if (connection.kind === "data") {
			const value = proposal.outputs[connection.from.output];
			if (!value) return undefined;
			inputs.push({
				connectionId: connection.id,
				proposalId: proposal.id,
				output: connection.from.output,
				input: connection.to.input,
				value,
			});
		}
	}
	return { inputs, ...(historyCaptureId ? { historyCaptureId } : {}) };
}

export function authorizeGate(caller: DagCaller, authority: GateAuthority): void {
	if (authority === "human" && caller.kind !== "human")
		fail("forbidden", "This gate requires a human decision");
}

export function unresolvedGates(state: DagState) {
	return Object.values(state.gates).filter((gate) => {
		const attempt = state.nodes[gate.target.nodeId]?.attempts.at(-1);
		return attempt?.number === gate.target.attempt && !attempt.stale && !gate.decision;
	});
}

export function prepareEdit(
	state: DagState,
	edits: GraphEdit[],
	caller: DagCaller | Pick<DagCaller, "kind">,
): { definition: DagDefinition; affected: Set<string>; authority?: GateAuthority } {
	const definition = applyEdits(state.definitionValue, edits);
	const affected = affectedNodes(state.definitionValue, definition);
	const busy = [...affected].filter((id) => state.nodes[id] && active(state.nodes[id]));
	if (busy.length)
		throw new DagError({
			code: "invalid-command",
			message: "Interrupt and settle affected work before editing",
			nodeIds: busy,
		});
	let authority: GateAuthority | undefined;
	const requireHuman = (reason: string) => {
		if (caller.kind !== "human") fail("forbidden", reason);
		authority = "human";
	};
	for (const before of state.definitionValue.nodes) {
		const next = definition.nodes.find((node) => node.id === before.id);
		if (
			before.approval?.authority === "human" &&
			(!next?.approval || canonicalJson(before.approval) !== canonicalJson(next.approval))
		)
			requireHuman("Only a human may remove or change a human-only release policy");
		const humanInput =
			before.inputAuthority === "human" ||
			Object.values(state.gates).some(
				(gate) =>
					gate.kind === "input" && gate.target.nodeId === before.id && gate.authority === "human",
			);
		if (humanInput && (!next || (next.inputAuthority ?? "human") !== "human"))
			requireHuman("Only a human may weaken an established human input policy");
	}
	for (const gate of unresolvedGates(state)) {
		if (gate.authority !== "human") continue;
		const guarded = descendants(state.definitionValue, gate.target.nodeId);
		if ([...affected].some((id) => guarded.has(id)))
			requireHuman("This edit would supersede a human-only gate or its guarded dependency");
	}
	return { definition, affected, ...(authority ? { authority } : {}) };
}

export function descendants(definition: DagDefinition, source: string): Set<string> {
	const result = new Set([source]);
	for (const id of result) {
		for (const connection of definition.connections) {
			const { from, to } = endpoints(connection);
			if (from === id) result.add(to);
		}
	}
	return result;
}

export function invalidate(state: DagState, affected: Set<string>): void {
	for (const id of affected) {
		const node = state.nodes[id];
		if (!node) continue;
		const attempt = node.attempts.at(-1);
		if (attempt) attempt.stale = true;
		delete node.continuation;
		delete node.retryOutputs;
		delete node.skipped;
		for (const proposal of Object.values(state.proposals)) {
			if (proposal.target.nodeId === id && proposal.disposition !== "rejected")
				proposal.disposition = "superseded";
		}
		for (const gate of Object.values(state.gates)) {
			if (gate.target.nodeId === id) gate.disposition = "superseded";
		}
		for (const intervention of state.interventions) {
			if (intervention.target.nodeId === id) intervention.status = "superseded";
		}
	}
}

export function successful(activation: Activation): boolean {
	return (
		activation.phase === "settled" &&
		activation.outcome?.status === "completed" &&
		(activation.outcome.stopReason === "stop" || activation.outcome.stopReason === "toolUse")
	);
}
