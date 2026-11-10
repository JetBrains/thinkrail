import { App as CapApp } from "@capacitor/app";
import { chatTitle } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	connectRemoteProject,
	createHostRegistry,
	createRemoteSessions,
	type RemoteSessionItem,
	type SavedHost,
} from "@thinkrail/remote-client";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AddComputerScreen } from "./AddComputerScreen";
import { ChatsScreen } from "./ChatsScreen";
import { ComputersScreen } from "./ComputersScreen";
import { needsYouCount, useDoneSessions } from "./chats";
import { deviceLabel } from "./deviceLabel";
import { localStore } from "./deviceStore";
import { failureOf, failureText, type HostFailure, type HostStatus } from "./hostStatus";
import { NewWorktreeScreen } from "./NewWorktreeScreen";
import {
	leaveHost,
	pop,
	push,
	type Route,
	replaceTop,
	type Stack,
	TABS,
	type Tab,
} from "./navigation";
import { workspaceName } from "./ProjectTree";
import { type DevicePreferences, readPreferences, writePreferences } from "./preferences";
import { SessionScreen } from "./SessionScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SubagentScreen } from "./SubagentScreen";
import { isPairLink } from "./scanPairLink";
import { closeTopLayer } from "./sheet";
import { TabBar, tabLabelKey } from "./TabBar";
import { applyDevicePreferences } from "./theme";
import { Welcome } from "./Welcome";
import { ChatHistoryScreen, WorkspaceOpener } from "./WorkspaceScreen";

export type PairState = { kind: "idle" } | { kind: "pairing" } | { kind: "failed"; reason: string };

export function App() {
	const registry = useMemo(() => createHostRegistry(localStore), []);
	const controller = useMemo(() => createRemoteSessions(), []);
	const [hosts, setHosts] = useState<SavedHost[]>(() => registry.list());
	const [items, setItems] = useState<RemoteSessionItem[]>([]);
	const [pair, setPair] = useState<PairState>({ kind: "idle" });
	const [tab, setTab] = useState<Tab>("computers");
	const [stack, setStack] = useState<Stack>([]);
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
	const [collapsedHosts, setCollapsedHosts] = useState<ReadonlySet<string>>(() => new Set());
	const toggleHost = useCallback((hostKey: string) => {
		setCollapsedHosts((current) => {
			const next = new Set(current);
			if (!next.delete(hostKey)) next.add(hostKey);
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
			setStack((current) => leaveHost(current, hostKey));
			setHosts(registry.remove(hostKey));
		},
		[controller, registry, markFailure],
	);

	const pairWith = useCallback(
		async (link: string): Promise<boolean> => {
			setPair({ kind: "pairing" });
			try {
				const connection = await connectRemoteProject(link, {
					label: deviceLabel(navigator.userAgent),
				});
				const host: SavedHost = {
					hostKey: connection.hostKey,
					relayUrl: connection.relayUrl,
					relayUrls: connection.relayUrls,
					...(connection.nostr ? { nostr: connection.nostr } : {}),
					label: connection.hostName ?? hostLabelOf(connection),
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

	useEffect(
		() =>
			controller.onLost((hostKey, error) => {
				markFailure(hostKey, failureOf(error));
				setStack((current) => leaveHost(current, hostKey));
			}),
		[controller, markFailure],
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
		if (stack.length === 0) return false;
		setStack(pop);
		return true;
	}, [stack.length]);
	const open = (route: Route): void => setStack((current) => push(current, route));
	const replace = (route: Route): void => setStack((current) => replaceTop(current, route));

	useEffect(() => {
		const listener = CapApp.addListener("backButton", () => {
			if (!closeTopLayer() && !back()) void CapApp.minimizeApp();
		});
		return () => {
			void listener.then((handle) => handle.remove());
		};
	}, [back]);

	const doneSessions = useDoneSessions(items, localStore);

	if (hosts.length === 0) {
		return <Welcome pair={pair} onPair={pairWith} />;
	}
	const titleOf = (route: Route): string => {
		switch (route.kind) {
			case "addComputer":
				return t("mobile.devices.add");
			case "newWorktree":
				return t("mobile.tree.newWorktree");
			case "workspace":
				return workspaceName(t, route.workspace);
			default:
				return route.chat.title;
		}
	};
	const backLabel = (index: number): string => {
		const below = stack[index - 1];
		return below ? titleOf(below) : t(tabLabelKey(tab));
	};
	const tabBar = <TabBar tabs={TABS} active={tab} badge={needsYouCount(items)} onSelect={setTab} />;
	const screen = (route: Route, index: number): ReactNode => {
		const label = backLabel(index);
		switch (route.kind) {
			case "addComputer":
				return (
					<AddComputerScreen
						pair={pair}
						onPair={async (link) => {
							const paired = await pairWith(link);
							if (paired)
								setStack((current) =>
									current.at(-1)?.kind === "addComputer" ? pop(current) : current,
								);
							return paired;
						}}
						backLabel={label}
						onBack={back}
					/>
				);
			case "newWorktree":
				return (
					<NewWorktreeScreen
						project={route.project}
						client={controller.clientFor(route.hostKey)}
						backLabel={label}
						onBack={back}
						onStarted={({ workspace, chat, promptError }, prompt) =>
							replace({
								kind: "chat",
								hostKey: route.hostKey,
								project: route.project,
								workspace,
								chat: {
									...chat,
									title: prompt
										? (chatTitle(undefined, prompt)?.text ?? prompt)
										: t("store.chatTab.defaultName"),
									...(promptError ? { unsent: { text: prompt, reason: promptError } } : {}),
								},
							})
						}
					/>
				);
			case "workspace":
				return (
					<WorkspaceOpener
						workspace={route.workspace}
						sessionId={route.sessionId}
						client={controller.clientFor(route.hostKey)}
						items={hostItems(items, route.hostKey)}
						backLabel={label}
						onBack={back}
						onOpen={(chat) => replace({ ...route, kind: "chat", chat })}
						readOnly={controller.accessFor(route.hostKey) === "read"}
					/>
				);
			case "chat":
				return (
					<SessionScreen
						key={route.chat.sessionId}
						session={{
							hostKey: route.hostKey,
							project: route.project,
							workspaceId: route.workspace.id,
							workspaceRoot: route.workspace.worktreePath,
							...route.chat,
						}}
						controller={controller}
						items={hostItems(items, route.hostKey)}
						backLabel={label}
						onBack={back}
						onHistory={() =>
							open({
								kind: "history",
								hostKey: route.hostKey,
								project: route.project,
								workspace: route.workspace,
								chat: route.chat,
							})
						}
						readOnly={controller.accessFor(route.hostKey) === "read"}
						onOpenChat={(chat) => replace({ ...route, chat })}
						onOpenSubagent={(childSessionId) =>
							open({
								kind: "subagent",
								hostKey: route.hostKey,
								project: route.project,
								workspace: route.workspace,
								chat: route.chat,
								childSessionId,
							})
						}
					/>
				);
			case "subagent":
				return (
					<SubagentScreen
						key={route.childSessionId}
						subagent={{
							workspaceId: route.workspace.id,
							parentSessionId: route.chat.sessionId,
							childSessionId: route.childSessionId,
						}}
						client={controller.clientFor(route.hostKey)}
						workspaceRoot={route.workspace.worktreePath}
						backLabel={label}
						onBack={back}
					/>
				);
			case "history":
				return (
					<ChatHistoryScreen
						workspace={route.workspace}
						client={controller.clientFor(route.hostKey)}
						items={hostItems(items, route.hostKey)}
						current={route.chat.sessionId}
						readOnly={controller.accessFor(route.hostKey) === "read"}
						backLabel={label}
						onBack={back}
						onOpen={(chat) =>
							setStack((current) => [
								...pop(pop(current)),
								{
									kind: "chat",
									hostKey: route.hostKey,
									project: route.project,
									workspace: route.workspace,
									chat,
								},
							])
						}
					/>
				);
		}
	};
	return (
		<div className="relative h-full">
			<Layer covered={stack.length > 0 || tab !== "computers"}>
				<ComputersScreen
					hosts={hosts}
					statusOf={statusOf}
					controller={controller}
					items={items}
					pair={pair}
					onPair={pairWith}
					collapsed={collapsedHosts}
					onToggleHost={toggleHost}
					expanded={expanded}
					onToggle={toggleProject}
					onReconnect={(host) => void connectHost(host)}
					onForget={(host) => forgetHost(host.hostKey)}
					onNewWorktree={(hostKey, project) => open({ kind: "newWorktree", hostKey, project })}
					onOpen={(hostKey, project, workspace) =>
						open({ kind: "workspace", hostKey, project, workspace })
					}
					onAdd={() => open({ kind: "addComputer" })}
					footer={tabBar}
				/>
			</Layer>
			<Layer covered={stack.length > 0 || tab !== "chats"}>
				<ChatsScreen
					controller={controller}
					items={items}
					multiHost={hosts.length > 1}
					done={doneSessions.done}
					onClearDone={doneSessions.clear}
					onOpen={(item, place) =>
						open({
							kind: "workspace",
							hostKey: item.hostKey,
							...place,
							sessionId: item.record.sessionId,
						})
					}
					footer={tabBar}
				/>
			</Layer>
			<Layer covered={stack.length > 0 || tab !== "settings"}>
				<SettingsScreen
					hosts={hosts}
					statusOf={statusOf}
					onReconnect={(host) => void connectHost(host)}
					onForget={forgetHost}
					pair={pair}
					onPair={pairWith}
					preferences={preferences}
					onChange={changePreferences}
					footer={tabBar}
				/>
			</Layer>
			{stack.map((route, index) => (
				<Layer key={screenKey(route)} covered={index < stack.length - 1}>
					{screen(route, index)}
				</Layer>
			))}
		</div>
	);
}

/** One screen of the stack: the screens under the top stay mounted (scroll, loaded lists, transcript) but hidden and inert, so going back shows them as they were. */
function Layer({ covered, children }: { covered: boolean; children: ReactNode }) {
	return (
		<div
			className={covered ? "pointer-events-none absolute inset-0 opacity-0" : "absolute inset-0"}
			aria-hidden={covered || undefined}
			inert={covered}
		>
			{children}
		</div>
	);
}

/** A pushed screen's identity: a different chat or computer in the same slot mounts afresh. */
function screenKey(route: Route): string {
	switch (route.kind) {
		case "addComputer":
			return "addComputer";
		case "newWorktree":
			return `new:${route.hostKey}:${route.project.id}`;
		case "workspace":
			return `workspace:${route.hostKey}:${route.workspace.id}`;
		case "subagent":
			return `subagent:${route.hostKey}:${route.childSessionId}`;
		default:
			return `${route.kind}:${route.hostKey}:${route.chat.sessionId}`;
	}
}

const hostItems = (items: RemoteSessionItem[], hostKey: string) =>
	items.filter((item) => item.hostKey === hostKey);

/** A host name for a computer whose link sent none: the relay's address, else the Nostr relay it answered on. */
function hostLabelOf(connection: {
	relayUrl: string;
	relayUrls: readonly string[];
	nostr?: { relays: readonly string[] };
}): string {
	const url = connection.relayUrl || connection.relayUrls[0] || connection.nostr?.relays[0] || "";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
