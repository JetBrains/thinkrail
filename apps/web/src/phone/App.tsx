import { App as CapApp } from "@capacitor/app";
import { chatTitle, parsePairingUri } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	browserStore,
	createHostRegistry,
	createRemoteSessions,
	failureOf,
	type HostFailure,
	type HostStatus,
	hostStatusOf,
	type RemoteSessionItem,
	type SavedHost,
} from "@thinkrail/remote-client";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AddComputerScreen } from "./AddComputerScreen";
import { ChatsScreen } from "./ChatsScreen";
import { ComputersScreen } from "./ComputersScreen";
import { needsYouCount, useDoneSessions } from "./chats";
import { deviceLabel } from "./deviceLabel";
import { useRemoteSessions } from "./hostView";
import { NewWorktreeScreen } from "./NewWorktreeScreen";
import {
	leaveHost,
	pop,
	popIf,
	push,
	type Route,
	replaceTop,
	type Stack,
	stackMotion,
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
import { prefetchHostRequest } from "./useHostRequest";
import { PairingSplash, Welcome } from "./Welcome";
import { ChatHistoryScreen, WorkspaceOpener } from "./WorkspaceScreen";

export type PairState =
	| { kind: "idle" }
	| { kind: "pairing"; hostName?: string | undefined }
	| { kind: "failed"; failure: HostFailure };

export function App() {
	const registry = useMemo(() => createHostRegistry(browserStore), []);
	const controller = useMemo(() => createRemoteSessions(), []);
	const [hosts, setHosts] = useState<SavedHost[]>(() => registry.list());
	const remote = useRemoteSessions(controller);
	const { items } = remote;
	const [pair, setPair] = useState<PairState>({ kind: "idle" });
	const [tab, setTab] = useState<Tab>("computers");
	const [stack, setStack] = useState<Stack>([]);
	const [motion, setMotion] = useState<{ stack: Stack; entering: Route | null; leaving: Route[] }>({
		stack,
		entering: null,
		leaving: [],
	});
	if (motion.stack !== stack) {
		const moved = stackMotion(motion.stack, stack);
		setMotion({
			stack,
			entering: moved.entering,
			leaving: [...motion.leaving.filter((route) => !stack.includes(route)), ...moved.leaving],
		});
	}
	useEffect(() => {
		if (motion.leaving.length === 0) return;
		const timer = setTimeout(
			() => setMotion((current) => ({ ...current, leaving: [] })),
			SCREEN_POP_MS,
		);
		return () => clearTimeout(timer);
	}, [motion.leaving]);
	const [preferences, setPreferences] = useState<DevicePreferences>(() =>
		readPreferences(browserStore),
	);
	useLayoutEffect(() => applyDevicePreferences(preferences), [preferences]);
	const changePreferences = useCallback((next: DevicePreferences) => {
		writePreferences(browserStore, next);
		setPreferences(next);
	}, []);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
	const toggleProject = useCallback((key: string) => setExpanded(toggleIn(key)), []);
	const [collapsedHosts, setCollapsedHosts] = useState<ReadonlySet<string>>(() => new Set());
	const toggleHost = useCallback((hostKey: string) => setCollapsedHosts(toggleIn(hostKey)), []);
	const t = useT();
	const statusOf = (hostKey: string): HostStatus => hostStatusOf(remote.statuses.get(hostKey));
	const forgetHost = useCallback(
		(hostKey: string) => {
			controller.disconnect(hostKey);
			setStack((current) => leaveHost(current, hostKey));
			setHosts(registry.remove(hostKey));
		},
		[controller, registry],
	);

	const pairWith = useCallback(
		async (link: string): Promise<boolean> => {
			setPair({ kind: "pairing", hostName: parsePairingUri(link.trim())?.hostName });
			try {
				const host = await controller.pair(link, { label: deviceLabel(navigator.userAgent) });
				const client = controller.clientFor(host.hostKey);
				if (client) await prefetchHostRequest(client, "project.list", {}, PREFETCH_MS);
				setHosts(registry.add(host));
				setPair({ kind: "idle" });
				return true;
			} catch (error) {
				setPair({ kind: "failed", failure: failureOf(error) });
				return false;
			}
		},
		[controller, registry],
	);

	useEffect(() => {
		const offLost = controller.onLost((hostKey) =>
			setStack((current) => leaveHost(current, hostKey)),
		);
		const offRoutes = controller.onRoutes((host) => setHosts(registry.update(host)));
		const retryNow = (): void => controller.reconnectNow();
		const resume = CapApp.addListener("resume", retryNow);
		window.addEventListener("online", retryNow);
		for (const host of registry.list()) controller.connect(host);
		return () => {
			offLost();
			offRoutes();
			void resume.then((handle) => handle.remove());
			window.removeEventListener("online", retryNow);
			controller.stop();
		};
	}, [controller, registry]);

	useEffect(() => {
		const onLink = (url: string | undefined): void => {
			if (isPairLink(url)) void pairWith(url.trim());
		};
		void CapApp.getLaunchUrl()
			.then((launch) => onLink(launch?.url))
			.catch(() => {});
		const deepLink = CapApp.addListener("appUrlOpen", (event) => onLink(event.url));
		return () => {
			void deepLink.then((handle) => handle.remove());
		};
	}, [pairWith]);

	const back = useCallback((): boolean => {
		if (stack.length === 0) return false;
		setStack(pop);
		return true;
	}, [stack.length]);
	const open = (route: Route): void => setStack((current) => push(current, route));

	useEffect(() => {
		const listener = CapApp.addListener("backButton", () => {
			if (!closeTopLayer() && !back()) void CapApp.minimizeApp();
		});
		return () => {
			void listener.then((handle) => handle.remove());
		};
	}, [back]);

	const doneSessions = useDoneSessions(items, browserStore);

	const connecting = pair.kind === "pairing" ? <PairingSplash hostName={pair.hostName} /> : null;
	if (hosts.length === 0) {
		return connecting ?? <Welcome pair={pair} onPair={pairWith} />;
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
		const replace = (to: Route, under = 0): void =>
			setStack((current) => replaceTop(current, route, to, under));
		const close = (): void => setStack((current) => popIf(current, route));
		switch (route.kind) {
			case "addComputer":
				return (
					<AddComputerScreen
						pair={pair}
						onPair={async (link) => {
							const paired = await pairWith(link);
							if (paired) close();
							return paired;
						}}
						backLabel={label}
						onBack={close}
					/>
				);
			case "newWorktree":
				return (
					<NewWorktreeScreen
						project={route.project}
						client={remote.clients.get(route.hostKey) ?? null}
						backLabel={label}
						onBack={close}
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
						client={remote.clients.get(route.hostKey) ?? null}
						items={hostItems(items, route.hostKey)}
						backLabel={label}
						onBack={close}
						onOpen={(chat) => replace({ ...route, kind: "chat", chat })}
						readOnly={remote.access.get(route.hostKey) === "read"}
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
						onBack={close}
						onHistory={() =>
							open({
								kind: "history",
								hostKey: route.hostKey,
								project: route.project,
								workspace: route.workspace,
								chat: route.chat,
							})
						}
						readOnly={remote.access.get(route.hostKey) === "read"}
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
						client={remote.clients.get(route.hostKey) ?? null}
						workspaceRoot={route.workspace.worktreePath}
						backLabel={label}
						onBack={close}
					/>
				);
			case "history":
				return (
					<ChatHistoryScreen
						workspace={route.workspace}
						client={remote.clients.get(route.hostKey) ?? null}
						items={hostItems(items, route.hostKey)}
						current={route.chat.sessionId}
						readOnly={remote.access.get(route.hostKey) === "read"}
						backLabel={label}
						onBack={close}
						onOpen={(chat) =>
							replace(
								{
									kind: "chat",
									hostKey: route.hostKey,
									project: route.project,
									workspace: route.workspace,
									chat,
								},
								1,
							)
						}
					/>
				);
		}
	};
	return (
		<div className="relative h-full">
			<Layer
				covered={stack.length > 0 || tab !== "computers"}
				visible={tab === "computers" && stack.length <= 1}
			>
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
					onReconnect={(host) => controller.connect(host)}
					onForget={(host) => forgetHost(host.hostKey)}
					onNewWorktree={(hostKey, project) => open({ kind: "newWorktree", hostKey, project })}
					onOpen={(hostKey, project, workspace) =>
						open({ kind: "workspace", hostKey, project, workspace })
					}
					onAdd={() => open({ kind: "addComputer" })}
					footer={tabBar}
				/>
			</Layer>
			<Layer
				covered={stack.length > 0 || tab !== "chats"}
				visible={tab === "chats" && stack.length <= 1}
			>
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
			<Layer
				covered={stack.length > 0 || tab !== "settings"}
				visible={tab === "settings" && stack.length <= 1}
			>
				<SettingsScreen
					hosts={hosts}
					statusOf={statusOf}
					onReconnect={(host) => controller.connect(host)}
					onForget={forgetHost}
					pair={pair}
					onPair={pairWith}
					preferences={preferences}
					onChange={changePreferences}
					footer={tabBar}
				/>
			</Layer>
			{[...stack, ...motion.leaving].map((route) => {
				const index = stack.indexOf(route);
				const leaving = index === -1;
				return (
					<Layer
						key={screenKey(route)}
						covered={leaving || index < stack.length - 1}
						visible={leaving || index >= stack.length - 2}
						motion={leaving ? "pop" : route === motion.entering ? "push" : undefined}
					>
						{screen(route, leaving ? stack.length : index)}
					</Layer>
				);
			})}
			{connecting ? <div className="absolute inset-0">{connecting}</div> : null}
		</div>
	);
}

/**
 * One full-screen layer. A covered layer is inert; it stays painted only while `visible` (the screen right
 * under the top one, which a pushed screen slides over), else it is transparent.
 */
function Layer({
	covered,
	visible = !covered,
	motion,
	children,
}: {
	covered: boolean;
	visible?: boolean;
	motion?: "push" | "pop" | undefined;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				"absolute inset-0",
				covered && "pointer-events-none",
				!visible && "opacity-0",
				motion === "push" && "motion-safe:animate-screen-push",
				motion === "pop" && "motion-safe:animate-screen-pop",
			)}
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

/** Matches `--animate-screen-pop` in phone.css: how long a popped screen stays mounted to slide out. */
const SCREEN_POP_MS = 260;
/** How long a fresh pairing waits for the computer's projects before showing the tree loading them itself. */
const PREFETCH_MS = 6_000;

const hostItems = (items: RemoteSessionItem[], hostKey: string) =>
	items.filter((item) => item.hostKey === hostKey);

const toggleIn =
	(key: string) =>
	(current: ReadonlySet<string>): ReadonlySet<string> => {
		const next = new Set(current);
		if (!next.delete(key)) next.add(key);
		return next;
	};
