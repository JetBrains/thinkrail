import type { Category } from "./model";
import {
	type ArtifactStatus,
	type DeltaCount,
	type DeltaRequirement,
	type OpenspecChange,
	type OpenspecSnapshot,
	type Stage,
	stageOf,
} from "./openspec";

/** The category each OpenSpec stage lands in: the spec-driven preset's columns, any preset's categories. */
export const STAGE_CATEGORIES: Readonly<Record<Stage, Category>> = {
	planning: "backlog",
	ready: "unstarted",
	"in-progress": "started",
	complete: "review",
	archived: "completed",
};

const OPENSPEC_CARD = /^openspec:([A-Za-z0-9_][A-Za-z0-9._-]{0,199})$/;

/** A change's card id while the board has not stored it (`openspec:add-2fa-login`); never a card id. */
export function openspecCardId(change: string): string {
	return `openspec:${change}`;
}

export function parseOpenspecCardId(id: string): string | null {
	return OPENSPEC_CARD.exec(id.trim())?.[1] ?? null;
}

/** The project's OpenSpec on a board read: whether Default has `openspec/`, and the user's CLI. */
export interface OpenspecStatus {
	present: boolean;
	/** The CLI's version, `null` without one (or while `checking`). */
	cli: string | null;
	checking: boolean;
}

/** A change on its card, live from the workspace it was read in; never stored. */
export interface OpenspecOverlay {
	/** Its folder's name (an archived one's carries the date). */
	change: string;
	workspaceId: string;
	dir: string;
	archived: boolean;
	stage: Stage;
	schema: string;
	error?: string;
	artifacts: { id: string; status: ArtifactStatus; files: string[] }[];
	nextArtifact: string | null;
	tasks: { completed: number; total: number };
	deltas: DeltaCount[];
	/** `validate --strict`'s last verdict, `null` without the CLI or before its first answer. */
	validation: { valid: boolean; errors: number; warnings: number } | null;
	/** `cli` once the CLI's `list` and `status` answered for this tree, else `files` (the parse). */
	source: "cli" | "files";
	/** For the card in Peek only: the delta requirements and the task lines. */
	requirements?: DeltaRequirement[];
	taskLines?: { done: boolean; text: string; path: string; line: number }[];
}

/** The change a card names: the active one of that name, else an archived one of that name or base name. */
export function findChange(
	changes: readonly OpenspecChange[],
	name: string,
): OpenspecChange | undefined {
	return (
		changes.find((change) => !change.archived && change.name === name) ??
		changes
			.filter((change) => change.archived && (change.name === name || change.baseName === name))
			.sort((a, b) => (a.name < b.name ? 1 : -1))[0]
	);
}

export function overlayOf(
	change: OpenspecChange,
	snapshot: OpenspecSnapshot,
	detail = false,
): OpenspecOverlay {
	const verdict = snapshot.validation.get(change.name);
	return {
		change: change.name,
		workspaceId: snapshot.workspaceId,
		dir: change.dir,
		archived: change.archived,
		stage: stageOf(change),
		schema: change.schema,
		...(change.error ? { error: change.error } : {}),
		artifacts: change.artifacts.map(({ id, status, files }) => ({ id, status, files })),
		nextArtifact: change.nextArtifact,
		tasks: change.tasks,
		deltas: change.deltas,
		validation:
			verdict && !change.archived
				? { valid: verdict.valid, errors: verdict.errors, warnings: verdict.warnings }
				: null,
		source: snapshot.source,
		...(detail
			? {
					requirements: change.requirements,
					taskLines: change.taskLines.map(({ done, text, path, line }) => ({
						done,
						text,
						path,
						line,
					})),
				}
			: {}),
	};
}
