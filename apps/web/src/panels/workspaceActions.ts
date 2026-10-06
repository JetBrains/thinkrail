import {
	type EditorInfo,
	WORKSPACE_RENAME_PROTOCOL_VERSION,
	type Workspace,
} from "@thinkrail/contracts";
import {
	type FocusEvent,
	type KeyboardEvent,
	type RefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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

export interface RenameController {
	start(currentName: string): void;
	commit(input: string): void;
	cancel(): void;
	setCanRename(canRename: boolean): void;
}

export function createRenameController(options: {
	canRename: boolean;
	onRename: (name: string) => void;
	onEditingChange: (editing: boolean) => void;
}): RenameController {
	let canRename = options.canRename;
	let editing = false;
	let startName = "";
	let pending: string | null = null;
	let cancelNext = false;
	const setEditing = (next: boolean) => {
		if (editing === next) return;
		editing = next;
		options.onEditingChange(next);
	};
	const dispatch = (name: string) => {
		pending = null;
		setEditing(false);
		options.onRename(name);
	};
	return {
		start(currentName) {
			startName = currentName;
			pending = null;
			cancelNext = false;
			setEditing(true);
		},
		commit(input) {
			if (!editing) return;
			if (cancelNext) {
				cancelNext = false;
				pending = null;
				setEditing(false);
				return;
			}
			const name = workspaceRenameValue(startName, input);
			if (!name) {
				pending = null;
				setEditing(false);
				return;
			}
			if (!canRename) {
				pending = name;
				return;
			}
			dispatch(name);
		},
		cancel() {
			cancelNext = true;
		},
		setCanRename(next) {
			canRename = next;
			if (canRename && editing && pending) dispatch(pending);
		},
	};
}

export interface WorkspaceRename {
	editing: boolean;
	nameRef: RefObject<HTMLInputElement | null>;
	start(): void;
	inputProps: {
		onBlur: (event: FocusEvent<HTMLInputElement>) => void;
		onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	};
	onMenuCloseAutoFocus(event: Event): void;
}

export function useWorkspaceRename(options: {
	workspace: Workspace | null;
	canRename: boolean;
	onRename: (name: string) => void;
}): WorkspaceRename {
	const [editing, setEditing] = useState(false);
	const nameRef = useRef<HTMLInputElement>(null);
	const enterRenameRef = useRef(false);
	const latest = useRef(options);
	latest.current = options;
	const controller = useMemo(
		() =>
			createRenameController({
				canRename: latest.current.canRename,
				onRename: (name) => latest.current.onRename(name),
				onEditingChange: setEditing,
			}),
		[],
	);

	useEffect(() => {
		controller.setCanRename(options.canRename);
	}, [controller, options.canRename]);

	useEffect(() => {
		if (!editing) return;
		const frame = requestAnimationFrame(() => {
			nameRef.current?.focus();
			nameRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editing]);

	return {
		editing,
		nameRef,
		start() {
			const workspace = latest.current.workspace;
			if (!workspace) return;
			enterRenameRef.current = true;
			controller.start(workspace.name);
		},
		inputProps: {
			onBlur: (event) => controller.commit(event.currentTarget.value),
			onKeyDown: (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				} else if (event.key === "Escape") {
					event.preventDefault();
					controller.cancel();
					event.currentTarget.blur();
				}
			},
		},
		onMenuCloseAutoFocus(event) {
			if (!enterRenameRef.current) return;
			enterRenameRef.current = false;
			event.preventDefault();
		},
	};
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
