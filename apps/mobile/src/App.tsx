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
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { failureOf, failureText, type HostFailure, type HostStatus } from "./hostStatus";
import { ProjectsScreen } from "./ProjectsScreen";
import { type DevicePreferences, readPreferences, writePreferences } from "./preferences";
import { SessionScreen } from "./SessionScreen";
import { SettingsScreen } from "./SettingsScreen";
import { isPairLink } from "./scanPairLink";
import { localStore } from "./store";
import { applyDevicePreferences } from "./theme";
import { Welcome } from "./Welcome";
import { ChatHistoryScreen, type OpenChat, WorkspaceOpener } from "./WorkspaceScreen";

const DEVICE_LABEL = "Mobile";

export type PairState = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; reason: string };

interface InWorkspace {
	hostKey: string;
	project: Project;
	workspace: Workspace;
}

/** The project tree → a workspace's main chat (opened while `workspace` resolves it) ⇄ its chat history. */
type Route =
	| { kind: "projects" }
	| { kind: "settings" }
	| ({ kind: "workspace" } & InWorkspace)
	| ({ kind: "chat"; chat: OpenChat } & InWorkspace)
	| ({ kind: "history"; chat: OpenChat } & InWorkspace);

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
		if (route.kind === "history") {
			setRoute({ ...route, kind: "chat" });
			return true;
		}
		if (route.kind !== "projects") {
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
	const top = route.kind === "projects" ? null : route;
	return (
		<div className="relative h-full">
			<Layer covered={top !== null}>
				<ProjectsScreen
					hosts={hosts}
					controller={controller}
					items={items}
					unreachable={
						new Map(
							[...failures].map(
								([hostKey, failure]) => [hostKey, failureText(t, failure)] as const,
							),
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
			</Layer>
			{top?.kind === "settings" ? (
				<Layer covered={false}>
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
				</Layer>
			) : null}
			{top?.kind === "workspace" ? (
				<Layer covered={false}>
					<WorkspaceOpener
						workspace={top.workspace}
						client={controller.clientFor(top.hostKey)}
						items={hostItems(items, top.hostKey)}
						backLabel={t("mobile.projects.title")}
						onBack={back}
						onOpen={(chat) => setRoute({ ...top, kind: "chat", chat })}
					/>
				</Layer>
			) : null}
			{top?.kind === "chat" || top?.kind === "history" ? (
				<Layer covered={top.kind === "history"}>
					<SessionScreen
						key={top.chat.sessionId}
						session={{ hostKey: top.hostKey, workspaceId: top.workspace.id, ...top.chat }}
						state={
							items.find(
								(item) =>
									item.hostKey === top.hostKey && item.record.sessionId === top.chat.sessionId,
							)?.record.state
						}
						controller={controller}
						items={hostItems(items, top.hostKey)}
						backLabel={t("mobile.projects.title")}
						onBack={back}
						onHistory={() => setRoute({ ...top, kind: "history" })}
					/>
				</Layer>
			) : null}
			{top?.kind === "history" ? (
				<Layer covered={false}>
					<ChatHistoryScreen
						workspace={top.workspace}
						client={controller.clientFor(top.hostKey)}
						items={hostItems(items, top.hostKey)}
						current={top.chat.sessionId}
						backLabel={top.chat.title}
						onBack={back}
						onOpen={(chat) => setRoute({ ...top, kind: "chat", chat })}
					/>
				</Layer>
			) : null}
		</div>
	);
}

/** One screen of the stack: the screens under the top stay mounted (scroll, loaded lists, transcript) but hidden and inert, so going back shows them as they were. */
function Layer({ covered, children }: { covered: boolean; children: ReactNode }) {
	return (
		<div
			className={covered ? "invisible absolute inset-0" : "absolute inset-0"}
			aria-hidden={covered || undefined}
			inert={covered}
		>
			{children}
		</div>
	);
}

const hostItems = (items: RemoteSessionItem[], hostKey: string) =>
	items.filter((item) => item.hostKey === hostKey);
