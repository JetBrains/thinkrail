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
	onOpen: (chat: OpenChat) => void;
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
	const sorted =
		loaded.kind === "ready"
			? { ...loaded, value: [...loaded.value].sort((a, b) => b.updatedAt - a.updatedAt) }
			: loaded;
	const now = Date.now();

	return (
		<Screen title={workspaceName(t, workspace)} back={{ label: backLabel, onBack }}>
			<LoadedList loaded={sorted} empty={t("mobile.workspace.empty")}>
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
								onOpen={() => onOpen({ sessionId: summary.sessionId, title: text })}
							/>
						);
					})
				}
			</LoadedList>
		</Screen>
	);
}
