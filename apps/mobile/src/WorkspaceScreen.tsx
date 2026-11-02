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
import { IconButton } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { ListRow, LoadedList, Notice, Screen } from "./layout";
import { workspaceName } from "./ProjectsScreen";
import { statusOf } from "./status";
import { useHostRequest } from "./useHostRequest";

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
}

export function WorkspaceScreen({
	workspace,
	client,
	items,
	backLabel,
	onBack,
	onOpen,
}: {
	workspace: Workspace;
	client: DeviceWireClient | null;
	items: RemoteSessionItem[];
	backLabel: string;
	onBack: () => void;
	/** `direct` when the chat is (or becomes) the workspace's only one, so back skips the list that would reopen it. */
	onOpen: (chat: OpenChat, direct: boolean) => void;
}) {
	const t = useT();
	const live = new Map(
		items
			.filter((item) => item.record.workspaceId === workspace.id)
			.map((item) => [item.record.sessionId, item.record]),
	);
	const loaded = useHostRequest<SessionSummary[]>(
		client,
		"session.list",
		{ workspaceId: workspace.id },
		[...live.keys()].sort().join(),
	);
	const byRecent = (a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt;
	const sorted =
		loaded.kind === "ready"
			? {
					...loaded,
					value: [
						...loaded.value.filter((summary) => summary.live).sort(byRecent),
						...loaded.value.filter((summary) => !summary.live).sort(byRecent),
					],
				}
			: loaded;
	const now = Date.now();
	const chatOf = (summary: SessionSummary): OpenChat => ({
		sessionId: summary.sessionId,
		title: chatTitle(summary.title, summary.firstPrompt)?.text ?? t("store.chatTab.defaultName"),
		model: summary.model,
		thinkingLevel: summary.thinkingLevel,
	});
	const only =
		sorted.kind === "ready" && sorted.value.length === 1 && sorted.value[0]?.live
			? sorted.value[0]
			: undefined;
	const [creating, setCreating] = useState(false);
	const [createFailure, setCreateFailure] = useState<string | null>(null);
	const createChat = (): void => {
		if (!client) return;
		setCreating(true);
		setCreateFailure(null);
		client
			.request<WsResult<"session.create">>("session.create", { workspaceId: workspace.id })
			.then((created) =>
				onOpen(
					{
						sessionId: created.sessionId,
						title: t("store.chatTab.defaultName"),
						model: created.model,
						thinkingLevel: created.thinkingLevel,
					},
					sorted.kind === "ready" && sorted.value.length === 0,
				),
			)
			.catch((error: unknown) =>
				setCreateFailure(error instanceof Error ? error.message : String(error)),
			)
			.finally(() => setCreating(false));
	};

	useEffect(() => {
		if (only) onOpen(chatOf(only), true);
	});

	return (
		<Screen
			title={workspaceName(t, workspace)}
			back={{ label: backLabel, onBack }}
			action={
				<IconButton
					size="l"
					className="size-touch shrink-0"
					icon={RiAddLine}
					label={t("mobile.workspace.newChat")}
					loading={creating}
					disabled={!client || creating}
					onClick={createChat}
				/>
			}
		>
			{createFailure ? (
				<Notice text={t("mobile.workspace.newChatFailed", { reason: createFailure })} alert />
			) : null}
			<LoadedList loaded={only ? { kind: "loading" } : sorted} empty={t("mobile.workspace.empty")}>
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
								status={statusOf(live.get(summary.sessionId)?.state ?? summary.state)}
								trailing={compactAge(t, summary.updatedAt, now)}
								onOpen={() => onOpen(chatOf(summary), summaries.length === 1)}
							/>,
						];
					})
				}
			</LoadedList>
		</Screen>
	);
}
