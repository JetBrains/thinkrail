import { FS_MUTATIONS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { fileName } from "../lib";
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
	const params = {
		sourceWorkspaceId: source.workspaceId,
		sourcePath: source.path,
		destinationWorkspaceId: workspaceId,
		destinationDirectory,
	};
	try {
		if (source.cut) {
			await getTransport().request("fs.move", params);
			if (useAppStore.getState().fileClipboard === source)
				useAppStore.getState().setFileClipboard(null);
		} else {
			await getTransport().request("fs.copy", params);
		}
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
					: code === "ENTRY_EXISTS"
						? t("panels.fileTree.pasteExists", { name: fileName(source.path) })
						: errorText(error),
			t("panels.fileTree.pasteFailed"),
		);
	}
}

export async function renameEntry(workspaceId: string, path: string, name: string): Promise<void> {
	try {
		await getTransport().request("fs.rename", { workspaceId, path, name });
		const store = useAppStore.getState();
		const clipboard = clipboardAfterDelete(store.fileClipboard, workspaceId, path);
		if (clipboard !== store.fileClipboard) store.setFileClipboard(clipboard);
	} catch (error) {
		toast.error(
			wsErrorCode(error) === "ENTRY_EXISTS"
				? t("panels.fileTree.renameExists", { name })
				: errorText(error),
			t("panels.fileTree.renameFailed"),
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
