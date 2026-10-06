import {
	type EditorInfo,
	WORKSPACE_RENAME_PROTOCOL_VERSION,
	type Workspace,
} from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport, prewarmWorkspaceSkillLoad } from "../transport";

const PREWARM_WORKSPACE_LIMIT = 8;

export async function loadProjectWorkspaces(projectId: string): Promise<Workspace[]> {
	const rows = await getTransport().request("workspace.list", { projectId });
	const store = useAppStore.getState();
	store.setWorkspaces(projectId, rows);
	if (store.selectedProjectId === projectId) {
		for (const workspace of rows.slice(0, PREWARM_WORKSPACE_LIMIT)) {
			void prewarmWorkspaceSkillLoad(workspace.id).catch(() => {});
		}
	}
	return rows;
}

export function canRenameWorkspace(protocolVersion: number | null, workspace: Workspace): boolean {
	return (
		protocolVersion !== null &&
		protocolVersion >= WORKSPACE_RENAME_PROTOCOL_VERSION &&
		workspace.kind !== "default" &&
		workspace.kind !== "external"
	);
}

export function workspaceRenameValue(currentName: string, input: string): string | null {
	const name = input.trim();
	return name && name !== currentName ? name : null;
}

export function useEditors(): EditorInfo[] {
	const [editors, setEditors] = useState<EditorInfo[]>([]);
	useEffect(() => {
		let cancelled = false;
		void getTransport()
			.request("editor.list", {})
			.then((list) => {
				if (!cancelled) setEditors(list);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);
	return editors;
}

export function removeWorkspace(workspaceId: string): void {
	void getTransport()
		.request("workspace.remove", { id: workspaceId })
		.catch((err) => toast.error(errorText(err, "Failed to remove workspace")));
}

export function openWorkspaceIn(workspace: Workspace, editor: EditorInfo): void {
	if (editor.kind === "terminal") {
		useAppStore.getState().activateWorkspace(workspace);
		useAppStore.getState().addTerminal(workspace.id, `${editor.id} .`);
		return;
	}
	void getTransport()
		.request("workspace.openIn", { id: workspace.id, editor: editor.id })
		.catch((err) => toast.error(errorText(err, `Failed to open in ${editor.label}`)));
}

export function revealWorkspace(workspace: Workspace): void {
	void getTransport()
		.request("workspace.reveal", { id: workspace.id })
		.catch((err) => toast.error(errorText(err, "Failed to reveal workspace")));
}

export function renameWorkspace(workspace: Workspace, name: string): void {
	void getTransport()
		.request("workspace.rename", { id: workspace.id, name })
		.catch((err) => toast.error(errorText(err, "Failed to rename workspace")));
}
