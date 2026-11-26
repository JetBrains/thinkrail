import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	AlignRow,
	AlignStep,
	SessionAlignment,
	SessionsAlignParams,
	SessionsAlignQuery,
	SessionsAlignResult,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { PENDING, type Pending, VersionSkew } from "../session/api";

export const SESSIONS_ALIGN: SessionsAlignQuery = "sessions.align";
const MAX_PAGES = 64;
const MAX_RESTARTS = 3;

function isAlignResult(value: unknown): value is SessionsAlignResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"apiVersion" in value &&
		value.apiVersion === API_VERSION &&
		"found" in value &&
		typeof value.found === "boolean" &&
		"alignment" in value
	);
}

/** Every page of an alignment merged, or the pages so far while `complete` is false. */
export interface LoadedAlignment {
	alignment: SessionAlignment;
	rows: readonly AlignRow[];
	stepsA: ReadonlyMap<number, AlignStep>;
	stepsB: ReadonlyMap<number, AlignStep>;
	complete: boolean;
	/** A side's file moved past the revision the pages were pinned to: a reload aligns the newer one. */
	newer: boolean;
}

/**
 * Pages `sessions.align` in, handing every growing prefix to `onProgress`; `null`: not found, `PENDING`:
 * the host's index has not reached a side yet. Later pages ask for the first page's revisions; a host
 * that no longer keeps them answers the current ones, and paging restarts.
 */
export async function loadAlignment(
	host: PanelHost,
	a: string,
	b: string,
	signal: AbortSignal,
	onProgress: (loaded: LoadedAlignment) => void,
): Promise<LoadedAlignment | Pending | null> {
	for (let restart = 0; restart <= MAX_RESTARTS; restart += 1) {
		let rows: AlignRow[] = [];
		const stepsA = new Map<number, AlignStep>();
		const stepsB = new Map<number, AlignStep>();
		let cursor: number | null = 0;
		let revisions: { a: string; b: string } | null = null;
		let loaded: LoadedAlignment | null = null;
		let moved = false;
		let newer = false;
		for (let page = 0; cursor !== null && page < MAX_PAGES; page++) {
			const params: SessionsAlignParams = { a, b, cursor, ...(revisions ? { revisions } : {}) };
			const value = await host.query(SESSIONS_ALIGN, params, signal);
			if (!isAlignResult(value)) throw new VersionSkew();
			const alignment = value.alignment;
			if (!value.found || !alignment) return value.pending === true ? PENDING : null;
			const sides = { a: alignment.a.revision, b: alignment.b.revision };
			if (revisions && (sides.a !== revisions.a || sides.b !== revisions.b)) {
				moved = true;
				break;
			}
			revisions = sides;
			rows = rows.concat(alignment.rows);
			for (const [index, step] of Object.entries(alignment.stepsA)) stepsA.set(Number(index), step);
			for (const [index, step] of Object.entries(alignment.stepsB)) stepsB.set(Number(index), step);
			cursor = alignment.next;
			newer ||= value.newerRevision;
			loaded = {
				alignment,
				rows,
				stepsA,
				stepsB,
				complete: cursor === null,
				newer,
			};
			onProgress(loaded);
		}
		if (!moved) return loaded;
	}
	throw new Error("The sessions kept changing while their alignment was paged");
}
