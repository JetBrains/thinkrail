import { agentBadge, type BoardView, type Card, type Category } from "./api";
import {
	type Forecast,
	type Initiative,
	initiativeDependencies,
	type RoadmapView,
	rollupBar,
	type ScheduleNode,
} from "./roadmapApi";

export const DAY_MS = 86_400_000;
const EPSILON = 0.01;

export type GraphScale = "weeks" | "days";
export const GRAPH_SCALES: readonly GraphScale[] = ["weeks", "days"];
/** Pixels per day at each zoom preset; a drag snaps to whole days at either. */
export const SCALE_PX: Readonly<Record<GraphScale, number>> = { weeks: 16, days: 40 };

/** The step graph's geometry, in flow pixels. */
export const GRAPH = {
	header: 32,
	laneTop: 24,
	row: 56,
	node: 44,
	minWidth: 72,
	clearance: 12,
	milestone: 22,
	milestoneLabel: 120,
} as const;

/** The timeline's geometry, in flow pixels. */
export const TIMELINE = {
	header: 32,
	row: 48,
	node: 40,
	barTop: 22,
	bar: 12,
	minWidth: 8,
} as const;

export type NodeStatus =
	| "done"
	| "working"
	| "waiting"
	| "failed"
	| "started"
	| "triage"
	| "ready"
	| "backlog";

const PINNABLE: ReadonlySet<Category> = new Set(["triage", "backlog", "unstarted"]);

export function isoOfDay(day: number): string {
	return new Date(Math.floor(day) * DAY_MS).toISOString().slice(0, 10);
}

export function dayOfIso(iso: string): number {
	return Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
}

/** Day 4 (1970-01-05) was a Monday. */
function isMonday(day: number): boolean {
	return ((day % 7) + 7) % 7 === 4;
}

/** A day's x on the graph: today is 0, a day is `px` wide. */
export function xOfDay(day: number, today: number, px: number): number {
	return (day - today) * px;
}

/** Every Monday from `day0` to `day1`, the week grid's lines. */
export function mondays(day0: number, day1: number): number[] {
	const weeks: number[] = [];
	for (let day = Math.ceil(day0); day <= day1; day++) if (isMonday(day)) weeks.push(day);
	return weeks;
}

/** A card's look on the graph: done, its agent's state, else its category. */
export function nodeStatus(card: Pick<Card, "category" | "live"> | undefined): NodeStatus {
	if (!card) return "backlog";
	if (card.category === "completed") return "done";
	const badge = agentBadge(card);
	if (badge === "working" || badge === "waiting" || badge === "failed") return badge;
	if (card.category === "started" || card.category === "review") return "started";
	if (card.category === "triage") return "triage";
	if (card.category === "unstarted") return "ready";
	return "backlog";
}

/** A card drags along time while it has not started and no agent works or waits on it. */
export function canDrag(card: Pick<Card, "category"> | undefined, status: NodeStatus): boolean {
	return !!card && PINNABLE.has(card.category) && status !== "working" && status !== "waiting";
}

/** A card's border, fill and opacity by status; critical, conflict and selection add theirs. */
export const NODE_LOOKS: Readonly<Record<NodeStatus, string>> = {
	done: "border-feedback-success-muted opacity-60",
	working: "border-primary",
	waiting: "border-feedback-warning",
	failed: "border-feedback-error",
	started: "border-primary-muted",
	triage: "border-dashed border-series-3",
	ready: "border-border-default",
	backlog: "border-border-muted",
};

export function nodeLook(
	node: Pick<GraphNodeLayout, "status" | "critical" | "conflict">,
	selected: boolean,
): string {
	const look = [NODE_LOOKS[node.status]];
	if (node.conflict) look.push("border-feedback-error");
	if (selected) look.push("ring-2 ring-primary");
	else if (node.critical) look.push("ring-1 ring-feedback-warning");
	return look.join(" ");
}

/** An edge's stroke and arrow fill: selected, a conflict (dashed), critical (animated), else quiet. */
export function edgeLook(
	edge: Pick<GraphEdgeLayout, "critical" | "conflict">,
	selected: boolean,
): { stroke: string; fill: string } {
	if (selected) return { stroke: "stroke-primary stroke-2", fill: "fill-primary" };
	if (edge.conflict)
		return { stroke: "stroke-feedback-error stroke-2", fill: "fill-feedback-error" };
	if (edge.critical)
		return { stroke: "stroke-feedback-warning stroke-2", fill: "fill-feedback-warning" };
	return { stroke: "stroke-text-subtle stroke-1", fill: "fill-text-subtle" };
}

/** An initiative and every initiative nested under it. */
function subtreeOf(view: Pick<RoadmapView, "initiatives">, id: string): Set<string> {
	const byId = new Map(view.initiatives.map((initiative) => [initiative.id, initiative]));
	const ids = new Set<string>();
	const stack = [id];
	for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
		if (ids.has(next)) continue;
		ids.add(next);
		stack.push(...(byId.get(next)?.childIds ?? []));
	}
	return ids;
}

/** The nodes a scope shows: an initiative's cards and its projects' milestones; `null` is the board. */
export function scopeMembers(
	view: Pick<RoadmapView, "initiatives" | "projects">,
	scope: string | null,
): Set<string> | null {
	if (scope === null) return null;
	const initiative = view.initiatives.find((entry) => entry.id === scope);
	if (!initiative) return new Set();
	const tree = subtreeOf(view, scope);
	const milestones = view.projects
		.filter((project) => project.initiativeId && tree.has(project.initiativeId))
		.flatMap((project) => project.milestones.map((milestone) => milestone.id));
	return new Set([...initiative.memberCardIds, ...milestones]);
}

/** Intervals packed into rows, first fit by start: each row's next interval starts past the last's end. */
export function packRows(items: readonly { id: string; x0: number; x1: number }[]): {
	rows: Map<string, number>;
	count: number;
} {
	const ends: number[] = [];
	const rows = new Map<string, number>();
	const sorted = [...items].sort((a, b) => a.x0 - b.x0 || a.id.localeCompare(b.id));
	for (const item of sorted) {
		let row = ends.findIndex((end) => end <= item.x0);
		if (row === -1) {
			row = ends.length;
			ends.push(item.x1);
		} else ends[row] = item.x1;
		rows.set(item.id, row);
	}
	return { rows, count: Math.max(1, ends.length) };
}

export interface GraphNodeLayout {
	id: string;
	kind: "card" | "milestone";
	lane: string | null;
	title: string;
	x: number;
	y: number;
	width: number;
	height: number;
	start: number;
	end: number;
	status: NodeStatus;
	critical: boolean;
	conflict: boolean;
	pinned: boolean;
	late: boolean;
	/** The slack shown beside a card: off the critical path, not done, more than none. */
	slack: number | null;
	draggable: boolean;
	/** The hatched wait for the human at a waiting card's end, in pixels. */
	wait: number;
	card?: Card;
	/** A milestone's project's initiative. */
	initiativeId?: string;
}

export interface GraphLane {
	id: string | null;
	title: string | null;
	top: number;
	height: number;
}

export interface GraphEdgeLayout {
	id: string;
	from: string;
	to: string;
	critical: boolean;
	conflict: boolean;
	/** A card's `blocks` link; a card's edge to its milestone is its membership. */
	deletable: boolean;
}

export interface GraphLayout {
	today: number;
	px: number;
	day0: number;
	day1: number;
	height: number;
	lanes: GraphLane[];
	nodes: GraphNodeLayout[];
	edges: GraphEdgeLayout[];
	weeks: number[];
	/** The milestones shown, earliest first: the header's forecast dates. */
	milestones: GraphNodeLayout[];
	/** The critical cards shown, earliest first. */
	criticalPath: string[];
}

function waitWidth(node: ScheduleNode, today: number, px: number, width: number): number {
	const days = Math.max(0.5, node.end - Math.max(node.start, today));
	return Math.min(width, days * px);
}

/**
 * The step graph's layout: x is time (today at 0, `px` a day), lanes are the roadmap projects (then
 * *No project*), each lane's nodes packed into rows. A scope shows one initiative's cards and milestones
 * with its own critical path; `null` shows the whole board's.
 */
export function stepGraphLayout(
	view: Pick<RoadmapView, "initiatives" | "projects" | "schedule" | "critical">,
	board: Pick<BoardView, "cards"> | null,
	scope: string | null,
	px: number,
): GraphLayout {
	const { today } = view.schedule;
	const members = scopeMembers(view, scope);
	const shown = view.schedule.nodes.filter((node) => !members || members.has(node.id));
	const critical = members
		? new Set(view.critical[scope ?? ""] ?? [])
		: new Set(shown.filter((node) => node.critical).map((node) => node.id));
	const cards = new Map((board?.cards ?? []).map((card) => [card.id, card]));
	const milestoneOf = new Map(
		view.projects.flatMap((project) =>
			project.milestones.map((milestone) => [milestone.id, { milestone, project }] as const),
		),
	);

	const placed = shown.map((node): GraphNodeLayout => {
		const isCritical = critical.has(node.id);
		if (node.kind === "milestone") {
			const owner = milestoneOf.get(node.id);
			return {
				id: node.id,
				kind: "milestone",
				lane: node.lane,
				title: owner?.milestone.title ?? node.id,
				x: xOfDay(node.end, today, px) - GRAPH.milestone / 2,
				y: 0,
				width: GRAPH.milestone,
				height: GRAPH.milestone,
				start: node.start,
				end: node.end,
				status: node.done ? "done" : "backlog",
				critical: isCritical,
				conflict: false,
				pinned: false,
				late: !!node.late,
				slack: null,
				draggable: false,
				wait: 0,
				...(owner?.project.initiativeId ? { initiativeId: owner.project.initiativeId } : {}),
			};
		}
		const card = cards.get(node.id);
		const status = node.done ? "done" : nodeStatus(card);
		const width = Math.max((node.end - node.start) * px, GRAPH.minWidth);
		return {
			id: node.id,
			kind: "card",
			lane: node.lane,
			title: card?.title ?? node.id,
			x: xOfDay(node.start, today, px),
			y: 0,
			width,
			height: GRAPH.node,
			start: node.start,
			end: node.end,
			status,
			critical: isCritical,
			conflict: node.conflict,
			pinned: node.pinned,
			late: false,
			slack: !isCritical && !node.done && node.slack > 0 ? node.slack : null,
			draggable: canDrag(card, status),
			wait: status === "waiting" ? waitWidth(node, today, px, width) : 0,
			...(card ? { card } : {}),
		};
	});

	const laneIds = [
		...view.projects.map((project) => project.id).filter((id) => placed.some((n) => n.lane === id)),
		...(placed.some((node) => node.lane === null || !view.projects.some((p) => p.id === node.lane))
			? [null]
			: []),
	];
	const laneOf = (node: GraphNodeLayout) => (laneIds.includes(node.lane) ? node.lane : null);
	const lanes: GraphLane[] = [];
	let top = GRAPH.header;
	for (const id of laneIds) {
		const inLane = placed.filter((node) => laneOf(node) === id);
		const { rows, count } = packRows(
			inLane.map((node) => ({
				id: node.id,
				x0: node.x,
				x1:
					node.x +
					node.width +
					(node.kind === "milestone" ? GRAPH.milestoneLabel : 0) +
					GRAPH.clearance,
			})),
		);
		for (const node of inLane) {
			const rowTop = top + GRAPH.laneTop + (rows.get(node.id) ?? 0) * GRAPH.row;
			node.y = node.kind === "milestone" ? rowTop + (GRAPH.node - GRAPH.milestone) / 2 : rowTop;
		}
		const height = GRAPH.laneTop + count * GRAPH.row;
		lanes.push({
			id,
			title: id === null ? null : (view.projects.find((p) => p.id === id)?.title ?? id),
			top,
			height,
		});
		top += height;
	}

	const byId = new Map(placed.map((node) => [node.id, node]));
	const edges = view.schedule.edges.flatMap((edge): GraphEdgeLayout[] => {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (!from || !to) return [];
		return [
			{
				id: `${edge.from}->${edge.to}`,
				from: edge.from,
				to: edge.to,
				critical: members
					? critical.has(from.id) && critical.has(to.id) && Math.abs(from.end - to.start) < EPSILON
					: edge.critical,
				conflict: edge.conflict,
				deletable: from.kind === "card" && to.kind === "card",
			},
		];
	});

	const starts = placed.map((node) => node.start);
	const ends = placed.map((node) => node.end);
	const day0 = Math.floor(Math.min(today - 7, ...starts)) - 2;
	const day1 = Math.ceil(Math.max(today + 21, ...ends)) + 7;
	const byTime = (a: GraphNodeLayout, b: GraphNodeLayout) => a.start - b.start || a.end - b.end;
	return {
		today,
		px,
		day0,
		day1,
		height: top,
		lanes,
		nodes: placed,
		edges,
		weeks: mondays(day0, day1),
		milestones: placed.filter((node) => node.kind === "milestone").sort((a, b) => a.end - b.end),
		criticalPath: placed
			.filter((node) => node.kind === "card" && node.critical)
			.sort(byTime)
			.map((node) => node.id),
	};
}

export interface TimelineMilestone {
	id: string;
	title: string;
	day: number;
	late: boolean;
}

export interface TimelineRow {
	kind: "initiative" | "project";
	id: string;
	title: string;
	depth: number;
	/** The initiative a click opens: its own, or a project's. */
	initiativeId: string | null;
	/** The row's box from its earliest to its latest day, bar, band and target included. */
	x: number;
	y: number;
	width: number;
	spanStart: number;
	/** The plan's bar; `null` for a project with no cards. */
	bar: { start: number; end: number } | null;
	/** Done of its cards, 0 to 1. */
	done: number;
	/** The 50 % to 85 % forecast, absent without enough data. */
	band: { p50: number; p85: number } | null;
	target: number | null;
	milestones: TimelineMilestone[];
	/** Its roadmap projects, shown under it while `expanded`. */
	projects: number;
	expanded: boolean;
	insufficient: boolean;
}

export interface TimelineLayout {
	today: number;
	px: number;
	day0: number;
	day1: number;
	height: number;
	rows: TimelineRow[];
	edges: { id: string; from: string; to: string }[];
	weeks: number[];
}

function forecastDays(forecast: Forecast | undefined): { p50: number; p85: number } | null {
	return forecast?.status === "ok"
		? { p50: dayOfIso(forecast.p50), p85: dayOfIso(forecast.p85) }
		: null;
}

function spanOf(nodes: readonly ScheduleNode[]): { start: number; end: number } | null {
	if (nodes.length === 0) return null;
	return {
		start: Math.min(...nodes.map((node) => node.start)),
		end: Math.max(...nodes.map((node) => node.end)),
	};
}

function rowBox(
	row: Omit<TimelineRow, "x" | "y" | "width" | "spanStart">,
	fallback: number,
): { spanStart: number; spanEnd: number } {
	const days = [
		...(row.bar ? [row.bar.start, row.bar.end] : []),
		...(row.band ? [row.band.p50, row.band.p85] : []),
		...(row.target !== null ? [row.target] : []),
		...row.milestones.map((milestone) => milestone.day),
	];
	if (days.length === 0) return { spanStart: fallback, spanEnd: fallback };
	return { spanStart: Math.min(...days), spanEnd: Math.max(...days) };
}

/**
 * The timeline: a row per initiative (depth-first), its bar from its cards' earliest start to its target
 * (else its 50 % forecast, else its cards' latest end) filled as done, its 50–85 % forecast band and its
 * target; an expanded initiative's roadmap projects follow it with their cards' span and milestones.
 * Links between initiatives are `initiativeDependencies`.
 */
export function timelineLayout(
	view: Pick<
		RoadmapView,
		"initiatives" | "projects" | "schedule" | "forecast" | "rollups" | "insufficientData"
	>,
	px: number,
	expanded: ReadonlySet<string>,
): TimelineLayout {
	const { today } = view.schedule;
	const nodes = new Map(view.schedule.nodes.map((node) => [node.id, node]));
	const nodesOf = (ids: Iterable<string>) => [...ids].flatMap((id) => nodes.get(id) ?? []);
	const milestonesOf = (projectIds: ReadonlySet<string>) =>
		view.projects
			.filter((project) => projectIds.has(project.id))
			.flatMap((project) => project.milestones)
			.flatMap((milestone): TimelineMilestone[] => {
				const node = nodes.get(milestone.id);
				return node
					? [{ id: milestone.id, title: milestone.title, day: node.end, late: !!node.late }]
					: [];
			});

	const drafts: Omit<TimelineRow, "x" | "y" | "width" | "spanStart">[] = [];
	const initiativeRow = (initiative: Initiative) => {
		const forecast = view.forecast[initiative.id];
		const span = spanOf(nodesOf(initiative.memberCardIds));
		const band = forecastDays(forecast);
		const target = initiative.target ? dayOfIso(initiative.target) : null;
		const start = span?.start ?? Math.floor(initiative.createdAt / DAY_MS);
		const end = target ?? band?.p50 ?? span?.end ?? start + 1;
		const own = view.projects.filter((project) => project.initiativeId === initiative.id);
		drafts.push({
			kind: "initiative",
			id: initiative.id,
			title: initiative.title,
			depth: initiative.depth,
			initiativeId: initiative.id,
			bar: { start, end: Math.max(end, start + 1) },
			done:
				forecast?.status === "done"
					? 1
					: rollupBar(view.rollups.initiatives[initiative.id]).percent / 100,
			band,
			target,
			milestones: [],
			projects: own.length,
			expanded: expanded.has(initiative.id),
			insufficient: forecast?.status === "insufficient",
		});
		if (!expanded.has(initiative.id)) return;
		for (const project of own) {
			const cards = view.schedule.nodes.filter(
				(node) => node.kind === "card" && node.lane === project.id,
			);
			const bar = spanOf(cards);
			const rollup = view.rollups.projects[project.id];
			drafts.push({
				kind: "project",
				id: project.id,
				title: project.title,
				depth: initiative.depth + 1,
				initiativeId: initiative.id,
				bar: bar ? { start: bar.start, end: Math.max(bar.end, bar.start + 1) } : null,
				done: rollupBar(rollup).percent / 100,
				band: null,
				target: null,
				milestones: milestonesOf(new Set([project.id])),
				projects: 0,
				expanded: false,
				insufficient: false,
			});
		}
	};
	for (const initiative of view.initiatives) initiativeRow(initiative);

	const rows = drafts.map((draft, index): TimelineRow => {
		const { spanStart, spanEnd } = rowBox(draft, today);
		return {
			...draft,
			spanStart,
			x: xOfDay(spanStart, today, px),
			y: TIMELINE.header + index * TIMELINE.row,
			width: Math.max((spanEnd - spanStart) * px, TIMELINE.minWidth),
		};
	});
	const shown = new Set(rows.filter((row) => row.kind === "initiative").map((row) => row.id));
	const edges = [...initiativeDependencies(view)].flatMap(([waiting, before]) =>
		before
			.filter((entry) => shown.has(entry.id) && shown.has(waiting))
			.map((entry) => ({ id: `${entry.id}->${waiting}`, from: entry.id, to: waiting })),
	);
	const starts = rows.map((row) => row.spanStart);
	const ends = rows.map((row) => row.spanStart + row.width / px);
	const day0 = Math.floor(Math.min(today - 7, ...starts)) - 2;
	const day1 = Math.ceil(Math.max(today + 28, ...ends)) + 7;
	return {
		today,
		px,
		day0,
		day1,
		height: TIMELINE.header + Math.max(1, rows.length) * TIMELINE.row,
		rows,
		edges,
		weeks: mondays(day0, day1),
	};
}
