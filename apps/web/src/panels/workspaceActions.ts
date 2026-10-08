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
	useInsertionEffect,
	useRef,
	useState,
} from "react";
import { supportsWorkspaceSettling, toast, useAppStore } from "../store";
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

export function canSettleWorkspace(protocolVersion: number | null, workspace: Workspace): boolean {
	return supportsWorkspaceSettling(protocolVersion) && workspace.kind !== "default";
}

export function settleWorkspace(workspaceId: string): void {
	void getTransport()
		.request("workspace.settle", { id: workspaceId })
		.catch((err) => toast.error(errorText(err, "Couldn't settle the workspace")));
}

export function unsettleWorkspace(workspaceId: string): void {
	void getTransport()
		.request("workspace.unsettle", { id: workspaceId })
		.catch((err) => toast.error(errorText(err, "Couldn't keep the workspace active")));
}

export function workspaceRenameValue(currentName: string, input: string): string | null {
	const name = input.trim();
	return name && name !== currentName ? name : null;
}

export interface RenameController<T> {
	start(target: T, currentName: string): void;
	commit(input: string): void;
	cancel(): void;
	reset(): void;
	setCanRename(canRename: boolean): void;
}

export function createRenameController<T>(options: {
	canRename: boolean;
	onRename: (target: T, name: string) => void;
	onEditingChange: (editing: boolean) => void;
}): RenameController<T> {
	let canRename = options.canRename;
	let editing = false;
	let target: T | null = null;
	let startName = "";
	let pending: string | null = null;
	let cancelNext = false;
	const setEditing = (next: boolean) => {
		if (editing === next) return;
		editing = next;
		options.onEditingChange(next);
	};
	const close = () => {
		pending = null;
		cancelNext = false;
		setEditing(false);
	};
	const dispatch = (name: string) => {
		const renamed = target;
		close();
		if (renamed !== null) options.onRename(renamed, name);
	};
	return {
		start(nextTarget, currentName) {
			target = nextTarget;
			startName = currentName;
			pending = null;
			cancelNext = false;
			setEditing(true);
		},
		commit(input) {
			if (!editing) return;
			if (cancelNext) {
				close();
				return;
			}
			const name = workspaceRenameValue(startName, input);
			if (!name) {
				close();
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
		reset: close,
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

type RenameControllerOptions = Parameters<typeof createRenameController<Workspace>>[0];

function useRenameController(options: RenameControllerOptions): RenameController<Workspace> {
	const [controller] = useState(() => createRenameController(options));
	return controller;
}

export function useWorkspaceRename(options: {
	workspace: Workspace | null;
	canRename: boolean;
	onRename: (workspace: Workspace, name: string) => void;
}): WorkspaceRename {
	const { workspace, canRename, onRename } = options;
	const [editing, setEditing] = useState(false);
	const nameRef = useRef<HTMLInputElement>(null);
	const enterRenameRef = useRef(false);
	const onRenameRef = useRef(onRename);
	useInsertionEffect(() => {
		onRenameRef.current = onRename;
	});
	const controller = useRenameController({
		canRename: false,
		onRename: (target, name) => onRenameRef.current(target, name),
		onEditingChange: setEditing,
	});

	const workspaceId = workspace?.id ?? null;
	useEffect(() => {
		controller.reset();
	}, [controller, workspaceId]);

	useEffect(() => {
		controller.setCanRename(canRename);
	}, [controller, canRename]);

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
			if (!workspace) return;
			enterRenameRef.current = true;
			controller.start(workspace, workspace.name);
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
