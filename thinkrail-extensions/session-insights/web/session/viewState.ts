import type { PanelHost } from "@thinkrail/extension-api/web";
import { type DetailTab, TAB_LABEL } from "../details/tabs";

const SECTIONS = ["overview", "trace", "subagents", "errors", "cost", "files"] as const;
export type Section = (typeof SECTIONS)[number];

const TRACE_MODES = ["tree", "turns", "timeline"] as const;
export type TraceMode = (typeof TRACE_MODES)[number];

const CONTEXT_MODES = ["chart", "diff"] as const;
/** *Cost & context*'s context half: the chart or the request diff. */
export type ContextMode = (typeof CONTEXT_MODES)[number];

/** What a session tab or chat pane shows, kept by the host across remounts (`PanelHost.viewState`). */
export interface SessionViewState {
	section: Section;
	mode: TraceMode;
	selectedId: string | null;
	/** The trace tree's folds by event id. */
	open: readonly (readonly [string, boolean])[];
	/** The event at the top of the trace tree's viewport. */
	top: string | null;
	context: ContextMode;
	detailTab: DetailTab | null;
	chain: number | null;
	file: string | null;
}

export const INITIAL_VIEW: SessionViewState = {
	section: "overview",
	mode: "tree",
	selectedId: null,
	open: [],
	top: null,
	context: "chart",
	detailTab: null,
	chain: null,
	file: null,
};

/** The most folds kept; the latest win. */
export const MAX_FOLDS = 2000;
const SAVE_DELAY_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
	return options.find((option) => option === value) ?? fallback;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function folds(value: unknown): readonly (readonly [string, boolean])[] {
	if (!Array.isArray(value)) return [];
	const out: [string, boolean][] = [];
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const [id, open] = entry;
		if (typeof id === "string" && typeof open === "boolean") out.push([id, open]);
	}
	return out.slice(-MAX_FOLDS);
}

const DETAIL_TABS = Object.keys(TAB_LABEL) as DetailTab[];

/** A saved view state read back: every field checked, anything malformed or absent at its default. */
export function parseViewState(value: unknown): SessionViewState {
	if (!isRecord(value)) return INITIAL_VIEW;
	const chain = value.chain;
	return {
		section: oneOf(SECTIONS, value.section, INITIAL_VIEW.section),
		mode: oneOf(TRACE_MODES, value.mode, INITIAL_VIEW.mode),
		selectedId: text(value.selectedId),
		open: folds(value.open),
		top: text(value.top),
		context: oneOf(CONTEXT_MODES, value.context, INITIAL_VIEW.context),
		detailTab: DETAIL_TABS.find((tab) => tab === value.detailTab) ?? null,
		chain: typeof chain === "number" && Number.isInteger(chain) && chain >= 0 ? chain : null,
		file: text(value.file),
	};
}

/** The trace's folds as saved: the latest `MAX_FOLDS` entries. */
export function foldEntries(
	open: ReadonlyMap<string, boolean>,
): readonly (readonly [string, boolean])[] {
	return [...open.entries()].slice(-MAX_FOLDS);
}

type Save = (state: SessionViewState) => void;

/**
 * The view state of one session tab or pane: read once from the host on mount, changed by the views as
 * the user goes, and handed back to the host a moment after the last change and when the panel unmounts.
 */
export class ViewMemory {
	state: SessionViewState;
	private save: Save | undefined;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(initial: SessionViewState, save: Save | undefined) {
		this.state = initial;
		this.save = save;
	}

	static of(host: PanelHost): ViewMemory {
		return new ViewMemory(parseViewState(host.viewState), host.saveViewState?.bind(host));
	}

	attach(host: PanelHost): void {
		this.save = host.saveViewState?.bind(host);
	}

	remember(patch: Partial<SessionViewState>): void {
		this.state = { ...this.state, ...patch };
		if (!this.save || this.timer !== null) return;
		this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
	}

	flush(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.save?.(this.state);
	}
}
