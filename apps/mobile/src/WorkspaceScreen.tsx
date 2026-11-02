import { RiChat2Line } from "@remixicon/react";
import {
	type CompactAgeUnit,
	chatTitle,
	compactAgeOf,
	type SessionSummary,
	type Workspace,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import type { DeviceWireClient, RemoteSessionItem } from "@thinkrail/remote-client";
import { useEffect } from "react";
import { ListRow, LoadedList, Screen } from "./layout";
import { workspaceName } from "./ProjectScreen";
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
	/** `direct` when the workspace's only active chat opened without the list being shown. */
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
	const active =
		loaded.kind === "ready"
			? {
					...loaded,
					value: loaded.value
						.filter((summary) => summary.live)
						.sort((a, b) => b.updatedAt - a.updatedAt),
				}
			: loaded;
	const now = Date.now();
	const chatOf = (summary: SessionSummary): OpenChat => ({
		sessionId: summary.sessionId,
		title: chatTitle(summary.title, summary.firstPrompt)?.text ?? t("store.chatTab.defaultName"),
		model: summary.model,
		thinkingLevel: summary.thinkingLevel,
	});
	const only = active.kind === "ready" && active.value.length === 1 ? active.value[0] : undefined;

	useEffect(() => {
		if (only) onOpen(chatOf(only), true);
	});

	return (
		<Screen title={workspaceName(t, workspace)} back={{ label: backLabel, onBack }}>
			<LoadedList loaded={only ? { kind: "loading" } : active} empty={t("mobile.workspace.empty")}>
				{(summaries) =>
					summaries.map((summary) => {
						const title = chatTitle(summary.title, summary.firstPrompt);
						const text = title?.text ?? t("store.chatTab.defaultName");
						return (
							<ListRow
								key={summary.sessionId}
								icon={RiChat2Line}
								title={text}
								tooltip={title?.tooltip}
								status={statusOf(live.get(summary.sessionId)?.state ?? summary.state)}
								trailing={compactAge(t, summary.updatedAt, now)}
								onOpen={() => onOpen(chatOf(summary), false)}
							/>
						);
					})
				}
			</LoadedList>
		</Screen>
	);
}
