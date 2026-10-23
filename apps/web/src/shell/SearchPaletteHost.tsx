import { useOpenProject } from "../panels/useOpenProject";
import { goToProjectHome } from "../panels/workspaceActions";
import { SearchPalette } from "../search";
import { useAppStore } from "../store";
import { type SearchPaletteOptions, useSearchPalette } from "./useSearchPalette";

export interface SearchPaletteHostProps {
	readonly onNewWorkspace: (projectId: string) => void;
	readonly onToggleProjectsHome: () => void;
	readonly hasUpdateSettings: boolean;
}

export function SearchPaletteHost({
	onNewWorkspace,
	onToggleProjectsHome,
	hasUpdateSettings,
}: SearchPaletteHostProps) {
	const open = useAppStore((s) => s.searchOpen);
	const openProject = useOpenProject((project) => goToProjectHome(project.id));
	return (
		<>
			{open ? (
				<OpenSearchPalette
					openNewWorkspace={onNewWorkspace}
					toggleProjectsHome={onToggleProjectsHome}
					pickAndOpenProject={openProject.pickAndOpen}
					hasUpdateSettings={hasUpdateSettings}
				/>
			) : null}
			{openProject.dialogs}
		</>
	);
}

function OpenSearchPalette(options: SearchPaletteOptions) {
	return <SearchPalette {...useSearchPalette(options)} />;
}
