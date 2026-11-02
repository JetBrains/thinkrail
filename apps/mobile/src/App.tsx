import { App as CapApp } from "@capacitor/app";
import type { Project, Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	connectRemoteProject,
	createHostRegistry,
	createRemoteSessions,
	type RemoteSessionItem,
	type SavedHost,
} from "@thinkrail/remote-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PairForm } from "./PairForm";
import { ProjectsScreen, workspaceName } from "./ProjectsScreen";
import { SessionScreen } from "./SessionScreen";
import { isPairLink } from "./scanPairLink";
import { localStore } from "./store";
import { Welcome } from "./Welcome";
import { type OpenChat, WorkspaceScreen } from "./WorkspaceScreen";

const DEVICE_LABEL = "Mobile";

export type PairState = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; reason: string };

/** The project tree (projects expand into their live workspaces) → a workspace's active chats → a chat. */
type Route =
	| { kind: "projects" }
	| { kind: "workspace"; hostKey: string; project: Project; workspace: Workspace }
	| {
			kind: "chat";
			hostKey: string;
			project: Project;
			workspace: Workspace;
			chat: OpenChat;
			/** Opened straight from the tree because it is the workspace's only active chat. */
			direct: boolean;
	  };

const reasonOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export function App() {
	const registry = useMemo(() => createHostRegistry(localStore), []);
	const controller = useMemo(() => createRemoteSessions(), []);
	const [hosts, setHosts] = useState<SavedHost[]>(() => registry.list());
	const [items, setItems] = useState<RemoteSessionItem[]>([]);
	const [pair, setPair] = useState<PairState>({ kind: "idle" });
	const [adding, setAdding] = useState(false);
	const [route, setRoute] = useState<Route>({ kind: "projects" });
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
	const toggleProject = useCallback((key: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	}, []);
	const t = useT();
	const [unreachable, setUnreachable] = useState<ReadonlyMap<string, string>>(() => new Map());
	const markReachable = useCallback((label: string, failure: string | null) => {
		setUnreachable((current) => {
			if (current.get(label) === (failure ?? undefined)) return current;
			const next = new Map(current);
			if (failure === null) next.delete(label);
			else next.set(label, failure);
			return next;
		});
	}, []);

	const pairWith = useCallback(
		async (link: string): Promise<boolean> => {
			setPair({ kind: "pairing" });
			try {
				const connection = await connectRemoteProject(link, { label: DEVICE_LABEL });
				const host: SavedHost = {
					hostKey: connection.hostKey,
					relayUrl: connection.relayUrl,
					label: new URL(connection.relayUrl).host,
					pairedAt: Date.now(),
				};
				connection.close();
				setHosts(registry.add(host));
				await controller.connect(host);
				markReachable(host.label, null);
				setPair({ kind: "idle" });
				setAdding(false);
				return true;
			} catch (error) {
				setPair({ kind: "failed", reason: reasonOf(error) });
				return false;
			}
		},
		[controller, registry, markReachable],
	);

	useEffect(() => {
		const unsubscribe = controller.subscribe(() => setItems(controller.items()));
		for (const host of registry.list()) {
			void controller
				.connect(host)
				.then(() => markReachable(host.label, null))
				.catch((error: unknown) => markReachable(host.label, reasonOf(error)));
		}
		const onLink = (url: string | undefined): void => {
			if (isPairLink(url)) void pairWith(url.trim());
		};
		void CapApp.getLaunchUrl()
			.then((launch) => onLink(launch?.url))
			.catch(() => {});
		const deepLink = CapApp.addListener("appUrlOpen", (event) => onLink(event.url));
		return () => {
			unsubscribe();
			void deepLink.then((handle) => handle.remove());
			controller.stop();
		};
	}, [controller, registry, pairWith, markReachable]);

	if (hosts.length === 0) {
		return <Welcome pair={pair} onPair={pairWith} />;
	}
	if (route.kind === "chat") {
		const { hostKey, workspace, chat } = route;
		return (
			<SessionScreen
				session={{ hostKey, workspaceId: workspace.id, ...chat }}
				state={
					items.find((item) => item.hostKey === hostKey && item.record.sessionId === chat.sessionId)
						?.record.state
				}
				controller={controller}
				backLabel={route.direct ? t("mobile.projects.title") : workspaceName(t, workspace)}
				onBack={() =>
					setRoute(route.direct ? { kind: "projects" } : { ...route, kind: "workspace" })
				}
			/>
		);
	}
	if (route.kind === "workspace") {
		return (
			<WorkspaceScreen
				workspace={route.workspace}
				client={controller.clientFor(route.hostKey)}
				items={hostItems(items, route.hostKey)}
				backLabel={t("mobile.projects.title")}
				onBack={() => setRoute({ kind: "projects" })}
				onOpen={(chat, direct) => setRoute({ ...route, kind: "chat", chat, direct })}
			/>
		);
	}
	return (
		<ProjectsScreen
			hosts={hosts}
			controller={controller}
			items={items}
			unreachable={[...unreachable]}
			expanded={expanded}
			onToggle={toggleProject}
			adding={adding}
			onAdd={() => setAdding(true)}
			pairForm={<PairForm pair={pair} onPair={pairWith} onCancel={() => setAdding(false)} />}
			onOpen={(hostKey, project, workspace) =>
				setRoute({ kind: "workspace", hostKey, project, workspace })
			}
		/>
	);
}

const hostItems = (items: RemoteSessionItem[], hostKey: string) =>
	items.filter((item) => item.hostKey === hostKey);
