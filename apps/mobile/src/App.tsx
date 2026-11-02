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
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { failureOf, failureText, type HostFailure, type HostStatus } from "./hostStatus";
import { ProjectsScreen, workspaceName } from "./ProjectsScreen";
import { type DevicePreferences, readPreferences, writePreferences } from "./preferences";
import { SessionScreen } from "./SessionScreen";
import { SettingsScreen } from "./SettingsScreen";
import { isPairLink } from "./scanPairLink";
import { localStore } from "./store";
import { applyDevicePreferences } from "./theme";
import { Welcome } from "./Welcome";
import { type OpenChat, WorkspaceScreen } from "./WorkspaceScreen";

const DEVICE_LABEL = "Mobile";

export type PairState = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; reason: string };

/** The project tree (projects expand into their live workspaces) → a workspace's active chats → a chat. */
type Route =
	| { kind: "projects" }
	| { kind: "settings" }
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

export function App() {
	const registry = useMemo(() => createHostRegistry(localStore), []);
	const controller = useMemo(() => createRemoteSessions(), []);
	const [hosts, setHosts] = useState<SavedHost[]>(() => registry.list());
	const [items, setItems] = useState<RemoteSessionItem[]>([]);
	const [pair, setPair] = useState<PairState>({ kind: "idle" });
	const [route, setRoute] = useState<Route>({ kind: "projects" });
	const [preferences, setPreferences] = useState<DevicePreferences>(() =>
		readPreferences(localStore),
	);
	useLayoutEffect(() => applyDevicePreferences(preferences), [preferences]);
	const changePreferences = useCallback((next: DevicePreferences) => {
		writePreferences(localStore, next);
		setPreferences(next);
	}, []);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
	const toggleProject = useCallback((key: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	}, []);
	const t = useT();
	const [failures, setFailures] = useState<ReadonlyMap<string, HostFailure>>(() => new Map());
	const markFailure = useCallback((hostKey: string, failure: HostFailure | null) => {
		setFailures((current) => {
			if (failure === null && !current.has(hostKey)) return current;
			const next = new Map(current);
			if (failure === null) next.delete(hostKey);
			else next.set(hostKey, failure);
			return next;
		});
	}, []);
	const connectHost = useCallback(
		(host: SavedHost): Promise<void> => {
			markFailure(host.hostKey, null);
			return controller
				.connect(host)
				.then(() => markFailure(host.hostKey, null))
				.catch((error: unknown) => markFailure(host.hostKey, failureOf(error)));
		},
		[controller, markFailure],
	);
	const statusOf = (hostKey: string): HostStatus => {
		const failure = failures.get(hostKey);
		if (failure) return { kind: "unreachable", failure };
		return controller.clientFor(hostKey) ? { kind: "connected" } : { kind: "connecting" };
	};
	const forgetHost = useCallback(
		(hostKey: string) => {
			controller.disconnect(hostKey);
			markFailure(hostKey, null);
			setHosts(registry.remove(hostKey));
		},
		[controller, registry, markFailure],
	);

	const pairWith = useCallback(
		async (link: string): Promise<boolean> => {
			setPair({ kind: "pairing" });
			try {
				const connection = await connectRemoteProject(link, { label: DEVICE_LABEL });
				const host: SavedHost = {
					hostKey: connection.hostKey,
					relayUrl: connection.relayUrl,
					relayUrls: connection.relayUrls,
					label: connection.hostName ?? new URL(connection.relayUrl).host,
					pairedAt: Date.now(),
				};
				connection.close();
				controller.disconnect(host.hostKey);
				setHosts(registry.add(host));
				await connectHost(host);
				setPair({ kind: "idle" });
				return true;
			} catch (error) {
				setPair({ kind: "failed", reason: failureText(t, failureOf(error)) });
				return false;
			}
		},
		[controller, registry, connectHost, t],
	);

	useEffect(() => {
		const unsubscribe = controller.subscribe(() => setItems(controller.items()));
		for (const host of registry.list()) void connectHost(host);
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
	}, [controller, registry, pairWith, connectHost]);

	const back = useCallback((): boolean => {
		if (route.kind === "chat") {
			setRoute(route.direct ? { kind: "projects" } : { ...route, kind: "workspace" });
			return true;
		}
		if (route.kind === "workspace" || route.kind === "settings") {
			setRoute({ kind: "projects" });
			return true;
		}
		return false;
	}, [route]);

	useEffect(() => {
		const listener = CapApp.addListener("backButton", () => {
			if (!back()) void CapApp.minimizeApp();
		});
		return () => {
			void listener.then((handle) => handle.remove());
		};
	}, [back]);

	if (hosts.length === 0) {
		return <Welcome pair={pair} onPair={pairWith} />;
	}
	if (route.kind === "settings") {
		return (
			<SettingsScreen
				hosts={hosts}
				statusOf={statusOf}
				onReconnect={(host) => void connectHost(host)}
				onForget={forgetHost}
				pair={pair}
				onPair={pairWith}
				preferences={preferences}
				onChange={changePreferences}
				backLabel={t("mobile.projects.title")}
				onBack={back}
			/>
		);
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
				onBack={back}
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
				onBack={back}
				onOpen={(chat, direct) => setRoute({ ...route, kind: "chat", chat, direct })}
			/>
		);
	}
	return (
		<ProjectsScreen
			hosts={hosts}
			controller={controller}
			items={items}
			unreachable={
				new Map(
					[...failures].map(([hostKey, failure]) => [hostKey, failureText(t, failure)] as const),
				)
			}
			expanded={expanded}
			onToggle={toggleProject}
			onSettings={() => setRoute({ kind: "settings" })}
			onReconnect={(host) => void connectHost(host)}
			onOpen={(hostKey, project, workspace) =>
				setRoute({ kind: "workspace", hostKey, project, workspace })
			}
		/>
	);
}

const hostItems = (items: RemoteSessionItem[], hostKey: string) =>
	items.filter((item) => item.hostKey === hostKey);
