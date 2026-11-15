import { TERMINAL_LINKS_PROTOCOL_VERSION, type TerminalPathTarget } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { openFileAtLine, openFileInTab } from "./openTabs";
import type { TerminalLinkTarget } from "./terminalLinks";

export function resolveTerminalPaths(
	id: string | null,
	candidates: string[],
): Promise<TerminalPathTarget[]> {
	const { protocolVersion } = useAppStore.getState();
	if (
		id === null ||
		protocolVersion === null ||
		protocolVersion < TERMINAL_LINKS_PROTOCOL_VERSION
	) {
		return Promise.resolve([]);
	}
	return getTransport()
		.request("terminal.resolvePaths", { id, candidates })
		.then(({ targets }) => targets);
}

export function openTerminalLink(workspaceId: string, target: TerminalLinkTarget): void {
	if (target.kind === "url") {
		window.open(target.url, "_blank", "noopener,noreferrer");
	} else if (target.kind === "dir") {
		useAppStore.getState().revealFolderInFiles(workspaceId, target.path);
	} else if (target.line === undefined) {
		void openFileInTab(workspaceId, target.path, "keep");
	} else {
		const at = {
			line: target.line,
			...(target.column === undefined ? {} : { column: target.column }),
		};
		void openFileAtLine(workspaceId, target.path, at, "keep");
	}
}
