import type { PanelHost } from "@thinkrail/extension-api/web";
import { loadProjects, type ProjectSummary } from "./api";
import { shownProject, useBoardSelection } from "./boardState";
import { useAnyBoardChanged, useHostQuery } from "./useHostQuery";

/** The project Board view shows and the open projects to switch between, re-read on any board's change. */
export function useBoardProject(host: Pick<PanelHost, "query" | "onEvent" | "scope">): {
	projectId: string;
	projects: readonly ProjectSummary[] | null;
} {
	const selection = useBoardSelection();
	const read = useHostQuery("projects", (signal) => loadProjects(host, signal));
	useAnyBoardChanged(host, read.reload);
	const projects = read.state.kind === "ready" ? read.state.value : null;
	return {
		projectId: shownProject(selection.projectId, host.scope.projectId, projects),
		projects,
	};
}
