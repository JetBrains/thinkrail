import {
	type Card,
	type Category,
	latestAttempt,
	type Placement,
	type Preset,
	type Workflow,
} from "./model";

export interface ColumnDef {
	/** Stable id; the web half names it through a locale key. */
	id: string;
	/** The categories the column shows; the first is the one a card moved into it takes. */
	categories: readonly Category[];
	/** Triage and Canceled are lanes off the board's columns. */
	hidden?: true;
	/** A started column that shows the attempts of one workflow. */
	workflow?: Workflow;
}

const TRIAGE: ColumnDef = { id: "triage", categories: ["triage"], hidden: true };
const CANCELED: ColumnDef = { id: "canceled", categories: ["canceled"], hidden: true };

const COLUMNS: Record<Preset, readonly ColumnDef[]> = {
	"agentic-kanban": [
		TRIAGE,
		{ id: "backlog", categories: ["backlog"] },
		{ id: "ready", categories: ["unstarted"] },
		{ id: "designing", categories: ["started"], workflow: "brainstorm" },
		{ id: "building", categories: ["started"], workflow: "implement" },
		{ id: "review", categories: ["review"] },
		{ id: "done", categories: ["completed"] },
		CANCELED,
	],
	solo: [
		TRIAGE,
		{ id: "todo", categories: ["backlog", "unstarted"] },
		{ id: "doing", categories: ["started", "review"] },
		{ id: "done", categories: ["completed"] },
		CANCELED,
	],
	"spec-driven": [
		TRIAGE,
		{ id: "planning", categories: ["backlog"] },
		{ id: "ready-to-apply", categories: ["unstarted"] },
		{ id: "in-progress", categories: ["started"] },
		{ id: "complete", categories: ["review"] },
		{ id: "archived", categories: ["completed"] },
		CANCELED,
	],
};

export function columnsOf(preset: Preset): readonly ColumnDef[] {
	return COLUMNS[preset];
}

/** The column a category lands in; a started card's column follows its workflow when the preset splits it. */
export function columnFor(preset: Preset, category: Category, workflow?: Workflow): string {
	const candidates = COLUMNS[preset].filter((column) => column.categories.includes(category));
	const matched =
		candidates.find((column) => column.workflow === (workflow ?? "implement")) ?? candidates[0];
	if (!matched) throw new Error(`The ${preset} preset has no column for ${category}`);
	return matched.id;
}

/** Where a card moved into `columnId` lands: its category stays when the column shows it. */
export function placeInColumn(
	preset: Preset,
	card: Pick<Card, "category">,
	columnId: string,
): Placement | null {
	const column = COLUMNS[preset].find((candidate) => candidate.id === columnId);
	const [first] = column?.categories ?? [];
	if (!column || !first) return null;
	return {
		category: column.categories.includes(card.category) ? card.category : first,
		column: column.id,
	};
}

/** A card's column under `preset`, from its category and its latest attempt's workflow. */
export function columnOfCard(preset: Preset, card: Pick<Card, "category" | "attempts">): string {
	return columnFor(preset, card.category, latestAttempt(card)?.workflow);
}
