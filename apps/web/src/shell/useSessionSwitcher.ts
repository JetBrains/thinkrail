import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import { hasPlatformModifier } from "../lib";
import {
	type SwitcherProject,
	type SwitcherSession,
	selectSwitcherGroups,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";

export interface UseSessionSwitcher {
	groups: SwitcherProject[];
	navigate: (session: SwitcherSession) => void;
}

export function useSessionSwitcher(open: boolean, onClose: () => void): UseSessionSwitcher {
	const [titleBySession, setTitleBySession] = useState<Record<string, string>>({});

	const projects = useAppStore((state) => state.projects);
	const workspaces = useAppStore((state) => state.workspaces);
	const sessionStateByWorkspace = useAppStore((state) => state.sessionStateByWorkspace);
	const layoutDocumentsByWorkspace = useAppStore((state) => state.layoutDocumentsByWorkspace);
	const closedChatsByWorkspace = useAppStore((state) => state.closedChatsByWorkspace);

	const baseGroups = useMemo(
		() =>
			selectSwitcherGroups({
				projects,
				workspaces,
				sessionStateByWorkspace,
				layoutDocumentsByWorkspace,
				closedChatsByWorkspace,
			}),
		[
			projects,
			workspaces,
			sessionStateByWorkspace,
			layoutDocumentsByWorkspace,
			closedChatsByWorkspace,
		],
	);

	const groups = useMemo(() => {
		if (Object.keys(titleBySession).length === 0) return baseGroups;
		return baseGroups.map((group) => ({
			...group,
			sessions: group.sessions.map((session) => {
				const fetched = titleBySession[session.sessionId];
				return !session.chatTitle && fetched ? { ...session, chatTitle: fetched } : session;
			}),
		}));
	}, [baseGroups, titleBySession]);

	const groupsRef = useRef(groups);
	const onCloseRef = useRef(onClose);
	useInsertionEffect(() => {
		groupsRef.current = groups;
		onCloseRef.current = onClose;
	});

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const liveWorkspaces = new Map<string, string>();
		for (const group of groupsRef.current) {
			for (const session of group.sessions) {
				liveWorkspaces.set(session.workspaceId, session.projectId);
			}
		}
		const { workspaces: knownWorkspaces } = useAppStore.getState();
		const projectsNeedingNames = new Set<string>();
		for (const [workspaceId, projectId] of liveWorkspaces) {
			if (!(knownWorkspaces[projectId] ?? []).some((ws) => ws.id === workspaceId)) {
				projectsNeedingNames.add(projectId);
			}
		}
		for (const projectId of projectsNeedingNames) {
			// Authoritative workspace hydration must land even if the palette closes:
			// activateWorkspaceFromRoute relies on this list to resolve a selected
			// workspace from an unloaded project. Only component-local title state
			// below respects `cancelled`.
			void getTransport()
				.request("workspace.list", { projectId })
				.then((rows) => {
					useAppStore.getState().setWorkspaces(projectId, rows);
				})
				.catch(() => {});
		}
		for (const workspaceId of liveWorkspaces.keys()) {
			void getTransport()
				.request("session.list", { workspaceId })
				.then((summaries) => {
					if (cancelled) return;
					setTitleBySession((prev) => {
						const next = { ...prev };
						for (const summary of summaries) next[summary.sessionId] = summary.title;
						return next;
					});
				})
				.catch(() => {});
		}
		return () => {
			cancelled = true;
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === "KeyK" && !event.shiftKey && !event.altKey && hasPlatformModifier(event)) {
				event.preventDefault();
				onCloseRef.current();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open]);

	const navigate = useCallback((session: SwitcherSession) => {
		useAppStore
			.getState()
			.activateWorkspaceFromRoute(
				{ id: session.workspaceId, projectId: session.projectId },
				session.sessionId,
			);
		onCloseRef.current();
	}, []);

	return { groups, navigate };
}
