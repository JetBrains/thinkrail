import { RiAddLine, RiChat2Line, RiHistoryLine } from "@remixicon/react";
import {
	type CompactAgeUnit,
	chatTitle,
	compactAgeOf,
	type SessionSummary,
	type Workspace,
	type WsResult,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import type { DeviceWireClient, RemoteSessionItem } from "@thinkrail/remote-client";
import { Button, IconButton } from "@thinkrail/ui/button";
import { useLayoutEffect, useRef, useState } from "react";
import { useNow } from "../components/useNow";
import { reasonOf, singleFlight, useMounted } from "./async";
import { ListRow, LoadedList, Loader, Notice, Screen } from "./layout";
import { workspaceName } from "./ProjectTree";
import { statusOf } from "./status";
import { type Loaded, useHostRequest } from "./useHostRequest";

const COMPACT_AGE_KEYS = {
	underHour: "lib.compactAge.underHour",
	hours: "lib.compactAge.hours",
	days: "lib.compactAge.days",
	weeks: "lib.compactAge.weeks",
	months: "lib.compactAge.months",
} as const satisfies Record<CompactAgeUnit, string>;

const compactAge = (t: Translator, ms: number, now: number): string => {
	const { unit, count } = compactAgeOf(ms, now);
	return t(COMPACT_AGE_KEYS[unit], { count });
};

export interface OpenChat {
	sessionId: string;
	title: string;
	model: SessionSummary["model"];
	thinkingLevel: SessionSummary["thinkingLevel"];
	/** Set when the chat was started with a first message that did not go. */
	unsent?: { text: string; reason: string };
}

const byRecent = (a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt;

/** Open chats newest first, then the closed history newest first. */
const ordered = (summaries: SessionSummary[]): SessionSummary[] => [
	...summaries.filter((summary) => summary.live).sort(byRecent),
	...summaries.filter((summary) => !summary.live).sort(byRecent),
];

const chatOf = (t: Translator, summary: SessionSummary): OpenChat => ({
	sessionId: summary.sessionId,
	title: chatTitle(summary.title, summary.firstPrompt)?.text ?? t("store.chatTab.defaultName"),
	model: summary.model,
	thinkingLevel: summary.thinkingLevel,
});

export const createChat = async (
	t: Translator,
	client: DeviceWireClient,
	workspaceId: string,
): Promise<OpenChat> => {
	const created = await client.request<WsResult<"session.create">>("session.create", {
		workspaceId,
	});
	return {
		sessionId: created.sessionId,
		title: t("store.chatTab.defaultName"),
		model: created.model,
		thinkingLevel: created.thinkingLevel,
	};
};

/** A header's **+**: starts one chat at a time and opens it, unless the screen was left while it started. */
export function useStartChat(
	client: DeviceWireClient | null,
	workspaceId: string,
	onOpen: (chat: OpenChat) => void,
): { creating: boolean; failure: string | null; start: () => void } {
	const t = useT();
	const mounted = useMounted();
	const [creating, setCreating] = useState(false);
	const [flight] = useState(() => singleFlight(setCreating));
	const [failure, setFailure] = useState<string | null>(null);
	const start = (): void => {
		if (!client) return;
		setFailure(null);
		flight(() => createChat(t, client, workspaceId))?.then(
			(chat) => {
				if (mounted.current) onOpen(chat);
			},
			(error: unknown) => setFailure(reasonOf(error)),
		);
	};
	return { creating, failure, start };
}

/** The workspace's chats from `session.list`, re-read when a session appears or leaves in it. */
export function useWorkspaceChats(
	client: DeviceWireClient | null,
	workspaceId: string,
	items: RemoteSessionItem[],
): Loaded<SessionSummary[]> {
	const reload = items
		.filter((item) => item.record.workspaceId === workspaceId)
		.map((item) => item.record.sessionId)
		.sort()
		.join();
	return useHostRequest<SessionSummary[]>(client, "session.list", { workspaceId }, reload);
}

/** Tapping a workspace lands in its main chat, as the IDE does: the newest open one, else the newest from history, else a new one; a chat picked in the Chats tab (`sessionId`) lands in that one. */
export function WorkspaceOpener({
	workspace,
	sessionId,
	client,
	items,
	backLabel,
	onBack,
	onOpen,
	readOnly = false,
}: {
	workspace: Workspace;
	sessionId?: string | undefined;
	client: DeviceWireClient | null;
	items: RemoteSessionItem[];
	backLabel: string;
	onBack: () => void;
	onOpen: (chat: OpenChat) => void;
	/** The phone may only read: a workspace without a chat says so instead of starting one. */
	readOnly?: boolean;
}) {
	const t = useT();
	const chats = useWorkspaceChats(client, workspace.id, items);
	const mounted = useMounted();
	const [failure, setFailure] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [empty, setEmpty] = useState(false);
	const started = useRef(-1);

	useLayoutEffect(() => {
		if (started.current === attempt || chats.kind !== "ready" || !client) return;
		started.current = attempt;
		const main =
			chats.value.find((summary) => summary.sessionId === sessionId) ?? ordered(chats.value)[0];
		if (main) onOpen(chatOf(t, main));
		else if (readOnly) setEmpty(true);
		else
			createChat(t, client, workspace.id).then(
				(chat) => {
					if (mounted.current) onOpen(chat);
				},
				(error: unknown) => setFailure(reasonOf(error)),
			);
	}, [chats, client, workspace.id, sessionId, onOpen, readOnly, t, attempt, mounted]);

	return (
		<Screen title={workspaceName(t, workspace)} back={{ label: backLabel, onBack }}>
			{failure ? (
				<div className="flex flex-col items-center gap-8 pb-40">
					<Notice text={t("mobile.workspace.newChatFailed", { reason: failure })} alert />
					<Button
						variant="outline"
						className="h-touch rounded-md"
						data-testid="workspace-open-retry"
						onClick={() => {
							setFailure(null);
							setAttempt((count) => count + 1);
						}}
					>
						{t("common.retry")}
					</Button>
				</div>
			) : chats.kind === "failed" ? (
				<Notice text={t("mobile.list.failed", { reason: chats.reason })} alert />
			) : empty ? (
				<Notice text={t("mobile.workspace.readOnlyEmpty")} />
			) : (
				<Loader text={t("mobile.list.loading")} />
			)}
		</Screen>
	);
}

/** The chat's history button: switch between a workspace's chats or start one; Open first, then Recent. */
export function ChatHistoryScreen({
	workspace,
	client,
	items,
	current,
	backLabel,
	onBack,
	onOpen,
	readOnly = false,
}: {
	workspace: Workspace;
	client: DeviceWireClient | null;
	items: RemoteSessionItem[];
	current: string;
	/** The phone may only read: no **+** to start a chat. */
	readOnly?: boolean;
	backLabel: string;
	onBack: () => void;
	onOpen: (chat: OpenChat) => void;
}) {
	const t = useT();
	const live = new Map(
		items
			.filter((item) => item.record.workspaceId === workspace.id)
			.map((item) => [item.record.sessionId, item.record]),
	);
	const loaded = useWorkspaceChats(client, workspace.id, items);
	const sorted = loaded.kind === "ready" ? { ...loaded, value: ordered(loaded.value) } : loaded;
	const now = useNow();
	const {
		creating,
		failure: createFailure,
		start: startChat,
	} = useStartChat(client, workspace.id, onOpen);

	return (
		<Screen
			title={t("mobile.workspace.history")}
			back={{ label: backLabel, onBack }}
			action={
				readOnly ? undefined : (
					<IconButton
						size="l"
						className="size-touch shrink-0"
						icon={RiAddLine}
						label={t("mobile.workspace.newChat")}
						loading={creating}
						disabled={!client || creating}
						onClick={startChat}
					/>
				)
			}
		>
			{createFailure ? (
				<Notice text={t("mobile.workspace.newChatFailed", { reason: createFailure })} alert />
			) : null}
			<LoadedList loaded={sorted} empty={t("mobile.workspace.empty")}>
				{(summaries) =>
					summaries.map((summary, index) => {
						const title = chatTitle(summary.title, summary.firstPrompt);
						const text = title?.text ?? t("store.chatTab.defaultName");
						const sectionStart = index === 0 || summaries[index - 1]?.live !== summary.live;
						return [
							sectionStart ? (
								<li
									key={summary.live ? "open" : "recent"}
									className="px-16 pt-16 pb-4 text-text-subtle tr-text-eyebrow"
								>
									{summary.live ? t("mobile.workspace.open") : t("mobile.workspace.recent")}
								</li>
							) : null,
							<ListRow
								key={summary.sessionId}
								icon={summary.live ? RiChat2Line : RiHistoryLine}
								title={text}
								tooltip={title?.tooltip}
								detail={summary.sessionId === current ? t("mobile.workspace.current") : undefined}
								status={statusOf(live.get(summary.sessionId)?.state ?? summary.state)}
								trailing={compactAge(t, summary.updatedAt, now)}
								onOpen={() => onOpen(chatOf(t, summary))}
							/>,
						];
					})
				}
			</LoadedList>
		</Screen>
	);
}
