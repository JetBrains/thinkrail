import { FS_MUTATIONS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { type FileClipboard, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";

export function supportsFileMutations(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= FS_MUTATIONS_PROTOCOL_VERSION;
}

export function pasteDestination(path: string, kind: "dir" | "file"): string {
	if (kind === "dir") return path;
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "." : path.slice(0, slash);
}

export function clipboardAfterDelete(
	clipboard: FileClipboard | null,
	workspaceId: string,
	deletedPath: string,
): FileClipboard | null {
	if (clipboard?.workspaceId !== workspaceId) return clipboard;
	const inside = clipboard.path === deletedPath || clipboard.path.startsWith(`${deletedPath}/`);
	return inside ? null : clipboard;
}

export async function pasteInto(workspaceId: string, destinationDirectory: string): Promise<void> {
	const source = useAppStore.getState().fileClipboard;
	if (!source) return;
	try {
		await getTransport().request("fs.copy", {
			sourceWorkspaceId: source.workspaceId,
			sourcePath: source.path,
			destinationWorkspaceId: workspaceId,
			destinationDirectory,
		});
		if (destinationDirectory !== ".") {
			useAppStore.getState().setFilesTreeExpanded(workspaceId, [destinationDirectory], true);
		}
	} catch (error) {
		const code = wsErrorCode(error);
		toast.error(
			code === "COPY_TOO_LARGE"
				? t("panels.fileTree.pasteTooLarge")
				: code === "ENTRY_CHANGED"
					? t("panels.fileTree.pasteChanged")
					: errorText(error),
			t("panels.fileTree.pasteFailed"),
		);
	}
}

export async function deleteEntry(workspaceId: string, path: string): Promise<void> {
	try {
		await getTransport().request("fs.delete", { workspaceId, path });
		const store = useAppStore.getState();
		const clipboard = clipboardAfterDelete(store.fileClipboard, workspaceId, path);
		if (clipboard !== store.fileClipboard) store.setFileClipboard(clipboard);
	} catch (error) {
		toast.error(
			wsErrorCode(error) === "ENTRY_CHANGED"
				? t("panels.fileTree.deleteChanged", { name: path.slice(path.lastIndexOf("/") + 1) })
				: errorText(error),
			t("panels.fileTree.deleteFailed"),
		);
	}
}
