import type {
	Figure,
	Interval,
	PlanChange,
	PlanNote,
	PlanStep,
	SessionPlan,
	SkillActivation,
	TraceEvent,
	TurnBadges,
} from "./core.ts";
import type { TodoItem } from "./facts.ts";
import { addSpend, costOrigin, emptySpend, type SpendTotals, tokenTotals } from "./totals.ts";
import { type BuiltTrace, succeeded } from "./trace.ts";

/** Skills that shape a session (routing, planning, shipping) rather than one task, by name. */
const WORKFLOW_SKILLS: ReadonlySet<string> = new Set([
	"choosing-a-workflow",
	"brainstorming",
	"shipping-a-pr",
	"writing-specs",
	"starting-a-new-project",
	"setting-up-a-project",
	"importing-a-codebase",
	"asking-user-questions",
	"writing-workflow-skills",
	"kicking-off-a-workspace",
	"todos",
	"spec-graph",
]);

interface StepState {
	id: string;
	title: string;
	group: string | null;
	groupId: string | null;
	origin: "agent" | "user" | null;
	first: number;
	order: number;
	changes: PlanChange[];
	toolCalls: number;
	errors: number;
	spend: SpendTotals;
}

function failed(event: TraceEvent): boolean {
	return event.error === true && (event.kind === "tool" || event.kind === "llm");
}

function counted(value: number): Figure {
	return { value, origin: "counted" };
}

/** The depth-0 turn of every event, by event id (`null` before the first turn). */
export function turnsOf(events: readonly TraceEvent[]): Map<string, string | null> {
	const out = new Map<string, string | null>();
	let turn: string | null = null;
	for (const event of events) {
		if (event.depth === 0) turn = event.kind === "turn" ? event.id : null;
		out.set(event.id, turn);
	}
	return out;
}

class PlanTracker {
	readonly steps = new Map<string, StepState>();
	readonly groups = new Map<string, { id: string; title: string }>();
	readonly summaries: PlanNote[] = [];
	current: string | null = null;
	calls = 0;
	writes = 0;

	private change(step: StepState, change: PlanChange): void {
		const last = step.changes.at(-1);
		if (last?.status === change.status) return;
		step.changes.push(change);
		if (change.status === "inProgress") this.current = step.id;
		else if (this.current === step.id) this.current = null;
	}

	private upsert(item: TodoItem, t: number, eventId: string, tool: string, snapshot: boolean) {
		let step = this.steps.get(item.id);
		if (!step) {
			step = {
				id: item.id,
				title: item.title ?? item.id,
				group: item.group,
				groupId: item.groupId,
				origin: item.origin,
				first: t,
				order: this.steps.size,
				changes: [],
				toolCalls: 0,
				errors: 0,
				spend: emptySpend(),
			};
			this.steps.set(item.id, step);
		} else {
			if (item.title) step.title = item.title;
			if (item.groupId !== null) {
				step.groupId = item.groupId;
				step.group = item.group;
			}
			if (item.origin) step.origin = item.origin;
		}
		if (item.status)
			this.change(step, {
				t,
				status: item.status,
				eventId,
				tool,
				...(snapshot ? { snapshot: true as const } : {}),
			});
		return step;
	}

	apply(event: TraceEvent, trace: BuiltTrace): void {
		if (event.kind !== "tool" || !succeeded(event) || !event.tool.startsWith("todo_")) return;
		const facts = trace.facts.get(event.id);
		const result = facts?.result?.todo;
		const args = facts?.call?.todo ?? null;
		const t = event.t1;
		const id = event.id;
		this.calls += 1;
		switch (event.tool) {
			case "todo_write":
			case "todo_list": {
				if (result?.kind !== "plan") break;
				const replace = event.tool === "todo_write";
				if (replace) this.writes += 1;
				const snapshot = event.tool === "todo_list";
				for (const group of result.groups) this.groups.set(group.id, group);
				const seen = new Set<string>();
				for (const item of result.items) {
					this.upsert(item, t, id, event.tool, snapshot);
					seen.add(item.id);
				}
				if (replace)
					for (const step of this.steps.values())
						if (!seen.has(step.id) && step.changes.at(-1)?.status !== "removed")
							this.change(step, { t, status: "removed", eventId: id, tool: event.tool });
				if (!args?.filtered || replace) {
					const working = result.items.filter((item) => item.status === "inProgress");
					if (working.length > 0 && !working.some((item) => item.id === this.current))
						this.current = working[0]?.id ?? null;
				}
				break;
			}
			case "todo_add":
			case "todo_update": {
				const item = result?.items[0];
				if (!item) break;
				let placed = item;
				if (event.tool === "todo_add" && args?.group && item.groupId === null) {
					const group = [...this.groups.values()].find((g) => g.title === args.group) ?? null;
					placed = { ...item, groupId: group?.id ?? null, group: group?.title ?? args.group };
				}
				for (const paused of result?.paused ?? []) {
					const step = this.steps.get(paused);
					if (step) this.change(step, { t, status: "pending", eventId: id, tool: event.tool });
				}
				this.upsert(placed, t, id, event.tool, false);
				break;
			}
			case "todo_remove": {
				const step = args?.id ? this.steps.get(args.id) : undefined;
				if (step) this.change(step, { t, status: "removed", eventId: id, tool: event.tool });
				break;
			}
			case "todo_promote": {
				const group = result?.groups[0];
				if (!group) break;
				this.groups.set(group.id, group);
				const step = this.steps.get(group.id);
				if (step) this.change(step, { t, status: "promoted", eventId: id, tool: event.tool });
				break;
			}
			case "todo_plan_summary":
				if (args?.summary) this.summaries.push({ t, eventId: id, text: args.summary });
				break;
		}
	}
}

function activeOf(changes: readonly PlanChange[], end: number): Interval[] {
	const out: Interval[] = [];
	let open: number | null = null;
	for (const change of changes) {
		if (change.status === "inProgress") open ??= change.t;
		else if (open !== null) {
			out.push({ t0: open, t1: Math.max(open, change.t) });
			open = null;
		}
	}
	if (open !== null) out.push({ t0: open, t1: Math.max(open, end) });
	return out;
}

export interface PlanAnalysis {
	plan: SessionPlan | null;
	skills: SkillActivation[];
	turns: TurnBadges[];
	/** The step in progress when each event happened, by event id (events outside every step absent). */
	stepOf: ReadonlyMap<string, string>;
}

/**
 * The pi-todos plan rebuilt from the session's `todo_*` calls on the active branch, the skill
 * activations with their heuristic scopes, and each turn's plan and skill badges. Deterministic.
 */
export function analysePlan(trace: BuiltTrace): PlanAnalysis {
	const { events, meta } = trace;
	const end = meta.end ?? meta.start ?? 0;
	const tracker = new PlanTracker();
	const turnOf = turnsOf(events);
	const turnSteps = new Map<string, Set<string>>();
	const turnDone = new Map<string, number>();
	const stepOf = new Map<string, string>();
	for (const event of events) {
		const turn = turnOf.get(event.id) ?? null;
		const before = tracker.current;
		if (before) stepOf.set(event.id, before);
		const step = before ? tracker.steps.get(before) : undefined;
		if (step && event.kind === "llm")
			addSpend(step.spend, {
				input: event.tokens.input,
				output: event.tokens.output,
				cacheRead: event.tokens.cacheRead,
				cacheWrite: event.tokens.cacheWrite,
				cost: event.cost,
			});
		if (step && event.kind === "tool") step.toolCalls += 1;
		if (step && failed(event)) step.errors += 1;
		const planCall = event.kind === "tool" && event.tool.startsWith("todo_");
		const changesBefore = planCall
			? new Map(
					[...tracker.steps.values()].map((candidate) => [candidate.id, candidate.changes.length]),
				)
			: null;
		tracker.apply(event, trace);
		if (!turn) continue;
		const touched = turnSteps.get(turn) ?? new Set<string>();
		if (before) touched.add(before);
		if (changesBefore)
			for (const candidate of tracker.steps.values()) {
				const prior = changesBefore.get(candidate.id) ?? 0;
				const added = candidate.changes.slice(prior);
				if (added.length === 0 || added.every((change) => change.snapshot)) continue;
				touched.add(candidate.id);
				if (added.some((change) => change.status === "done"))
					turnDone.set(turn, (turnDone.get(turn) ?? 0) + 1);
			}
		turnSteps.set(turn, touched);
	}

	const steps: PlanStep[] = [...tracker.steps.values()]
		.sort((a, b) => a.order - b.order)
		.map((step) => ({
			id: step.id,
			title: step.title,
			group: step.group,
			origin: step.origin,
			first: step.first,
			changes: step.changes,
			active: activeOf(step.changes, end),
			status: step.changes.at(-1)?.status ?? "pending",
			...(step.changes.length > 0 && step.changes.every((change) => change.snapshot)
				? { listedOnly: true as const }
				: {}),
			toolCalls: counted(step.toolCalls),
			errors: counted(step.errors),
			tokens: { value: tokenTotals(step.spend), origin: "recorded" },
			cost: { value: step.spend.cost, origin: costOrigin(step.spend) },
		}));
	const plan: SessionPlan | null =
		steps.length > 0 || tracker.summaries.length > 0
			? {
					steps,
					groups: [...tracker.groups.values()],
					summaries: tracker.summaries,
					calls: tracker.calls,
					rewrites: Math.max(0, tracker.writes - 1),
				}
			: null;

	const skills = skillActivations(trace, turnOf);
	const turnSkills = new Map<string, string[]>();
	for (const skill of skills) {
		const turn = turnOf.get(skill.eventId);
		if (!turn) continue;
		const names = turnSkills.get(turn) ?? [];
		if (!names.includes(skill.name)) names.push(skill.name);
		turnSkills.set(turn, names);
	}
	const turns: TurnBadges[] = [];
	for (const event of events) {
		if (event.kind !== "turn") continue;
		const steps = turnSteps.get(event.id)?.size ?? 0;
		const names = turnSkills.get(event.id) ?? [];
		if (steps === 0 && names.length === 0) continue;
		turns.push({ turnId: event.id, steps, done: turnDone.get(event.id) ?? 0, skills: names });
	}
	return { plan, skills, turns, stepOf };
}

/** Skill activations with their heuristic scopes, in time order. */
export function skillActivations(
	trace: BuiltTrace,
	turnOf: ReadonlyMap<string, string | null>,
): SkillActivation[] {
	const { events, meta } = trace;
	const end = meta.end ?? meta.start ?? 0;
	const turnEnd = new Map<string, number>();
	for (const event of events) if (event.kind === "turn") turnEnd.set(event.id, event.t1);
	const raw: { name: string; t: number; eventId: string; via: "read" | "prompt" }[] = [];
	for (const event of events) {
		if (event.kind !== "tool" || !succeeded(event)) continue;
		const skill = trace.facts.get(event.id)?.call?.skill;
		if (skill) raw.push({ name: skill, t: event.t1, eventId: event.id, via: "read" });
	}
	for (const prompt of trace.promptSkills)
		raw.push({ name: prompt.name, t: prompt.t, eventId: prompt.eventId, via: "prompt" });
	raw.sort((a, b) => a.t - b.t || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0));
	return raw.map((activation, at) => {
		const turn = turnOf.get(activation.eventId) ?? null;
		const next = raw
			.slice(at + 1)
			.find(
				(candidate) =>
					candidate.t > activation.t && (turnOf.get(candidate.eventId) ?? null) === turn,
			);
		const ownEnd = turn ? (turnEnd.get(turn) ?? end) : end;
		const byNext = next !== undefined && next.t < ownEnd;
		return {
			...activation,
			workflow: WORKFLOW_SKILLS.has(activation.name),
			scopeEnd: byNext ? next.t : Math.max(activation.t, ownEnd),
			scopeBy: byNext ? "nextSkill" : turn ? "turnEnd" : "sessionEnd",
		};
	});
}
