import {
	type ChainOutcome,
	type ErrorCluster,
	type Figure,
	type LlmEvent,
	type ModelRecovery,
	RETRY_SHARED_WORDS,
	RETRY_WINDOW_CALLS,
	type RecoveryChain,
	type RepeatGroup,
	type ToolEvent,
	type ToolRecovery,
	type TraceEvent,
} from "./core.ts";
import { sharedWords } from "./facts.ts";
import { turnsOf } from "./plan.ts";
import { byText } from "./stats.ts";
import type { BuiltTrace } from "./trace.ts";

const BETWEEN_MAX = 8;

export interface FrictionAnalysis {
	repeats: RepeatGroup[];
	chains: RecoveryChain[];
	clusters: ErrorCluster[];
	toolRecovery: ToolRecovery[];
	toolFailures: number;
	modelRecovery: ModelRecovery;
}

function similar(trace: BuiltTrace, a: ToolEvent, b: ToolEvent): boolean {
	const left = trace.facts.get(a.id)?.call;
	const right = trace.facts.get(b.id)?.call;
	if (!left || !right) return false;
	if (left.path !== null && left.path === right.path) return true;
	return sharedWords(left.words, right.words) >= RETRY_SHARED_WORDS;
}

function spanOrigin(events: readonly TraceEvent[]): Figure["origin"] {
	return events.every((event) => event.timing === "recorded") ? "counted" : "approximated";
}

/** A failed call's error cluster key: its tool and normalized first error line (a heuristic). */
export function failureKey(trace: BuiltTrace, event: ToolEvent | LlmEvent): string {
	if (event.kind === "tool")
		return (
			trace.facts.get(event.id)?.result?.errorKey ??
			`${event.tool}: ${event.missing ? "(no result)" : "(empty)"}`
		);
	return trace.llmFailures.get(event.id)?.errorKey ?? `model: ${event.stop ?? "error"}`;
}

interface DraftChain extends Omit<RecoveryChain, "index" | "cluster"> {
	first: string;
}

/**
 * Repeats (two or more consecutive identical calls in issue order), recovery chains (a failure, its
 * retries and how it ended — a labelled heuristic; a retry without a recorded result ends its chain
 * `unfinished`), error clusters by normalized first error line, and recovery rates per tool and after
 * model errors. Deterministic.
 */
export function analyseFriction(trace: BuiltTrace): FrictionAnalysis {
	const { events } = trace;
	const turnOf = turnsOf(events);
	const calls = events.filter((event): event is ToolEvent => event.kind === "tool");
	const position = new Map(calls.map((call, at) => [call.id, at]));
	const keyOf = (call: ToolEvent) => trace.facts.get(call.id)?.call?.key ?? null;

	const repeats: RepeatGroup[] = [];
	for (let at = 0; at < calls.length; ) {
		const first = calls[at];
		const key = first ? keyOf(first) : null;
		let next = at + 1;
		while (
			first &&
			key !== null &&
			next < calls.length &&
			calls[next]?.tool === first.tool &&
			keyOf(calls[next] as ToolEvent) === key
		)
			next += 1;
		if (first && next - at >= 2) {
			const run = calls.slice(at, next);
			repeats.push({
				ids: run.map((call) => call.id),
				tool: first.tool,
				label: first.label,
				errors: run.filter((call) => call.error).length,
			});
		}
		at = next;
	}

	const drafts: DraftChain[] = [];
	const chained = new Set<string>();
	const betweenOf = (from: ToolEvent, to: ToolEvent) => {
		const a = position.get(from.id) ?? 0;
		const b = position.get(to.id) ?? 0;
		return calls.slice(a + 1, Math.min(b, a + 1 + BETWEEN_MAX)).map((call) => call.id);
	};
	calls.forEach((start, at) => {
		if (!start.error || chained.has(start.id)) return;
		const attempts: ToolEvent[] = [start];
		chained.add(start.id);
		let cursor = at;
		while (attempts.at(-1)?.error) {
			const last = attempts.at(-1) as ToolEvent;
			let found: ToolEvent | null = null;
			for (
				let next = cursor + 1;
				next < calls.length && next <= cursor + RETRY_WINDOW_CALLS;
				next++
			) {
				const candidate = calls[next];
				if (!candidate || turnOf.get(candidate.id) !== turnOf.get(last.id)) break;
				if (candidate.tool !== last.tool) continue;
				if (!chained.has(candidate.id) && similar(trace, last, candidate)) {
					found = candidate;
					cursor = next;
				}
				break;
			}
			if (!found) break;
			attempts.push(found);
			chained.add(found.id);
		}
		const last = attempts.at(-1) as ToolEvent;
		const outcome: ChainOutcome =
			attempts.length === 1
				? "changedApproach"
				: last.missing
					? "unfinished"
					: last.error
						? "gaveUp"
						: "recovered";
		drafts.push({
			kind: "tool",
			name: start.tool,
			attempts: attempts.map((attempt) => attempt.id),
			between: attempts.slice(1).map((attempt, k) => betweenOf(attempts[k] as ToolEvent, attempt)),
			outcome,
			t0: start.t0,
			t1: last.t1,
			recoveredIn:
				outcome === "recovered"
					? { value: Math.max(0, last.t1 - start.t1), origin: spanOrigin(attempts) }
					: { value: null, origin: "counted" },
			turnId: turnOf.get(start.id) ?? null,
			line: trace.facts.get(start.id)?.result?.errorLine ?? "",
			switches: 0,
			prompts: 0,
			first: start.id,
		});
	});

	const llms = events.filter((event): event is LlmEvent => event.kind === "llm");
	const llmAt = new Map(events.map((event, at) => [event.id, at]));
	for (let at = 0; at < llms.length; ) {
		const start = llms[at];
		if (!start?.error) {
			at += 1;
			continue;
		}
		let next = at;
		while (llms[next]?.error) next += 1;
		const failures = llms.slice(at, next);
		const recovery = llms[next] ?? null;
		const attempts = recovery ? [...failures, recovery] : failures;
		let switches = 0;
		for (let k = 1; k < attempts.length; k++)
			if (attempts[k]?.model !== attempts[k - 1]?.model) switches += 1;
		const from = llmAt.get(start.id) ?? 0;
		const to = recovery ? (llmAt.get(recovery.id) ?? from) : events.length;
		let prompts = 0;
		for (let k = from + 1; k < to; k++) if (events[k]?.kind === "turn") prompts += 1;
		const last = attempts.at(-1) as LlmEvent;
		drafts.push({
			kind: "model",
			name: start.model,
			attempts: attempts.map((attempt) => attempt.id),
			between: attempts.slice(1).map(() => []),
			outcome: !recovery ? "never" : recovery.model === start.model ? "sameModel" : "afterSwitch",
			t0: start.t0,
			t1: last.t1,
			recoveredIn: recovery
				? { value: Math.max(0, recovery.t1 - start.t1), origin: spanOrigin(attempts) }
				: { value: null, origin: "counted" },
			turnId: turnOf.get(start.id) ?? null,
			line: trace.llmFailures.get(start.id)?.errorLine ?? start.stop ?? "",
			switches,
			prompts,
			first: start.id,
		});
		at = next;
	}

	const clusterOf = new Map<string, number>();
	const grouped = new Map<
		string,
		{
			kind: "tool" | "model";
			key: string;
			sample: string;
			ids: string[];
			tools: Map<string, number>;
		}
	>();
	const addCluster = (
		kind: "tool" | "model",
		key: string,
		sample: string,
		id: string,
		tool: string,
	) => {
		let cluster = grouped.get(key);
		if (!cluster) {
			cluster = { kind, key, sample, ids: [], tools: new Map() };
			grouped.set(key, cluster);
		}
		cluster.ids.push(id);
		cluster.tools.set(tool, (cluster.tools.get(tool) ?? 0) + 1);
	};
	for (const event of events) {
		if (event.kind === "tool" && event.error) {
			const result = trace.facts.get(event.id)?.result;
			addCluster("tool", failureKey(trace, event), result?.errorLine ?? "", event.id, event.tool);
		} else if (event.kind === "llm" && event.error) {
			const failure = trace.llmFailures.get(event.id);
			addCluster(
				"model",
				failureKey(trace, event),
				failure?.errorLine ?? event.stop ?? "",
				event.id,
				event.model ?? "model",
			);
		}
	}
	const clusters: ErrorCluster[] = [...grouped.values()]
		.sort((a, b) => b.ids.length - a.ids.length || byText(a.key, b.key))
		.map((cluster, index) => {
			for (const id of cluster.ids) clusterOf.set(id, index);
			return {
				index,
				kind: cluster.kind,
				key: cluster.key,
				sample: cluster.sample,
				ids: cluster.ids,
				tools: [...cluster.tools]
					.sort(([a, x], [b, y]) => y - x || byText(a, b))
					.map(([tool, n]) => ({ tool, n })),
			};
		});

	const chains: RecoveryChain[] = drafts
		.sort((a, b) => a.t0 - b.t0 || byText(a.first, b.first))
		.map(({ first, ...chain }, index) => ({
			...chain,
			index,
			cluster: clusterOf.get(first) ?? null,
		}));

	const perTool = new Map<string, ToolRecovery>();
	let toolFailures = 0;
	for (const call of calls) {
		if (!call.error) continue;
		toolFailures += 1;
		const row = perTool.get(call.tool) ?? {
			tool: call.tool,
			failures: 0,
			chains: 0,
			recovered: 0,
			changedApproach: 0,
			gaveUp: 0,
			unfinished: 0,
		};
		row.failures += 1;
		perTool.set(call.tool, row);
	}
	const modelRecovery: ModelRecovery = {
		failures: llms.filter((call) => call.error).length,
		chains: 0,
		sameModel: 0,
		afterSwitch: 0,
		never: 0,
	};
	for (const chain of chains) {
		if (chain.kind === "model") {
			modelRecovery.chains += 1;
			if (chain.outcome === "sameModel") modelRecovery.sameModel += 1;
			else if (chain.outcome === "afterSwitch") modelRecovery.afterSwitch += 1;
			else modelRecovery.never += 1;
			continue;
		}
		const row = chain.name ? perTool.get(chain.name) : undefined;
		if (!row) continue;
		row.chains += 1;
		if (chain.outcome === "recovered") row.recovered += 1;
		else if (chain.outcome === "gaveUp") row.gaveUp += 1;
		else if (chain.outcome === "unfinished") row.unfinished += 1;
		else row.changedApproach += 1;
	}
	const toolRecovery = [...perTool.values()].sort(
		(a, b) => b.failures - a.failures || byText(a.tool, b.tool),
	);
	return { repeats, chains, clusters, toolRecovery, toolFailures, modelRecovery };
}
