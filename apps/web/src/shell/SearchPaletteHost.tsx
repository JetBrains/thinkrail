import { MAX_SEARCH_PREVIEW_BYTES } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import {
	type ResourceHost,
	ResourceHostProvider,
	ResourcePreview,
	useOptionalResourceHost,
} from "@thinkrail/resource-renderers";
import { useMemo } from "react";
import { startProjectSetupChat } from "../panels/setupPrompt";
import { useOpenProject } from "../panels/useOpenProject";
import { goToProjectHome } from "../panels/workspaceActions";
import { type PaletteFile, SearchPalette } from "../search";
import { useAppStore } from "../store";
import { getTransport, wsErrorCode } from "../transport";
import { type SearchPaletteOptions, useSearchPalette } from "./useSearchPalette";

function readBounded(workspaceId: string, path: string) {
	return getTransport()
		.request("fs.readFile", { workspaceId, path, maxBytes: MAX_SEARCH_PREVIEW_BYTES })
		.catch((error: unknown) => {
			throw wsErrorCode(error) === "FILE_TOO_LARGE"
				? new Error(t("search.palette.previewTooLarge"))
				: error;
		});
}

function BoundedPreview({ file }: { file: PaletteFile }) {
	const host = useOptionalResourceHost();
	const bounded = useMemo<ResourceHost | null>(
		() => (host ? { ...host, readFile: readBounded } : null),
		[host],
	);
	const preview = (
		<ResourcePreview workspaceId={file.workspaceId} path={file.path} className="h-full min-h-0" />
	);
	return bounded ? <ResourceHostProvider value={bounded}>{preview}</ResourceHostProvider> : preview;
}

function renderFilePreview(file: PaletteFile) {
	return <BoundedPreview key={`${file.workspaceId}\u0000${file.path}`} file={file} />;
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
