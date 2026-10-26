import { ResourcePreview } from "@thinkrail/resource-renderers";
import { startProjectSetupChat } from "../panels/setupPrompt";
import { useOpenProject } from "../panels/useOpenProject";
import { goToProjectHome } from "../panels/workspaceActions";
import { type PaletteFile, SearchPalette } from "../search";
import { useAppStore } from "../store";
import { type SearchPaletteOptions, useSearchPalette } from "./useSearchPalette";

function renderFilePreview(file: PaletteFile) {
	return (
		<ResourcePreview
			key={`${file.workspaceId}\u0000${file.path}`}
			workspaceId={file.workspaceId}
			path={file.path}
			className="h-full min-h-0"
		/>
	);
}

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
	const session = useAppStore((s) => s.searchSession);
	const openProject = useOpenProject((project, { setup }) => {
		goToProjectHome(project.id);
		if (setup) void startProjectSetupChat(project.id);
	});
	return (
		<>
			{open ? (
				<OpenSearchPalette
					key={session}
					openNewWorkspace={onNewWorkspace}
					toggleProjectsHome={onToggleProjectsHome}
					pickAndOpenProject={openProject.pickAndOpen}
					enterHostPath={openProject.enterHostPath}
					startNewProject={openProject.startNewProject}
					hasUpdateSettings={hasUpdateSettings}
					renderFilePreview={renderFilePreview}
				/>
			) : null}
			{openProject.dialogs}
		</>
	);
}

function OpenSearchPalette(options: SearchPaletteOptions) {
	return <SearchPalette {...useSearchPalette(options)} />;
}
