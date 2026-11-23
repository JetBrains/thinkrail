import type { PanelHost } from "@thinkrail/extension-api/web";
import { requestListView } from "../listIntent";
import type { OverviewLink } from "../overview/OverviewView";
import type { TraceIntent } from "../trace/TraceExplorer";
import type { Section, SessionViewState, TraceMode } from "./viewState";

/** The data a section asks for the first time it shows, kept across switches. */
export type Need = "timeline" | "subagents" | "cost" | "files";

export interface Navigation {
	section: Section;
	mode: TraceMode;
	selectedId: string | null;
	intent: TraceIntent | null;
	/** Bumped by a jump, so the trace remounts and reveals the event. */
	jump: number;
	/** The trace mounts scrolled to the selection (a jump) rather than back to its remembered top row. */
	reveal: boolean;
	seen: ReadonlySet<Need>;
}

export function needOf(section: Section, mode: TraceMode): Need | null {
	if (section === "trace") return mode === "tree" ? null : "timeline";
	if (section === "subagents" || section === "cost" || section === "files") return section;
	return null;
}

/** `navigation` moved to another place, the data that place needs marked as wanted. */
export function moved(navigation: Navigation, to: Partial<Omit<Navigation, "seen">>): Navigation {
	const next = { ...navigation, reveal: false, ...to };
	const need = needOf(next.section, next.mode);
	return need === null || navigation.seen.has(need)
		? next
		: { ...next, seen: new Set(navigation.seen).add(need) };
}

/**
 * Where a session view opens: on a pending focus request the trace's tree at that event (it wins over
 * whatever was saved), else where the tab or pane was left.
 */
export function initialNavigation(saved: SessionViewState, focus: string | null): Navigation {
	const start: Navigation = {
		section: saved.section,
		mode: saved.mode,
		selectedId: saved.selectedId,
		intent: null,
		jump: 0,
		reveal: false,
		seen: new Set(),
	};
	return focus === null
		? moved(start, {})
		: moved(start, { section: "trace", mode: "tree", selectedId: focus, reveal: true });
}

/** What an Overview link asks of the session view. */
export interface OverviewRoute {
	trace: (mode: TraceMode, events: readonly string[]) => void;
	section: (section: Exclude<Section, "trace" | "overview">) => void;
	/** *Cost & context* scrolled to its context half. */
	context: () => void;
	chain: (index: number) => void;
	file: (path: string) => void;
	findings: () => void;
}

export function routeOverviewLink(link: OverviewLink, route: OverviewRoute): void {
	switch (link.to) {
		case "trace":
			route.trace(link.mode ?? "tree", link.events ?? []);
			return;
		case "errors":
			route.section("errors");
			if (link.chain !== undefined) route.chain(link.chain);
			return;
		case "cost":
			if (link.view === "context") route.context();
			else route.section("cost");
			return;
		case "files":
			route.section("files");
			if (link.path !== undefined) route.file(link.path);
			return;
		case "subagents":
			route.section("subagents");
			return;
		case "findings":
			route.findings();
			return;
	}
}

const LIST_PANEL = "sessions";

/**
 * Shows this session's findings where they live: the list tab's Insights → What to do, over the session's
 * own project (the Overview counts them there), so a session of another project asks for all projects.
 */
export function openFindings(host: PanelHost, projectId: string | null): void {
	const scope = projectId !== null && projectId === host.scope.projectId ? "project" : "all";
	requestListView({ tab: "insights", section: "findings", scope });
	host.openPanel(LIST_PANEL);
}
