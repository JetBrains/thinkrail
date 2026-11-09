import { RiChat3Line } from "@remixicon/react";
import { chatTitle } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { RemoteSessionItem, RemoteSessionsController } from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import type { ReactNode } from "react";
import { type ChatPlace, type ChatSection, chatSections, useChatPlaces } from "./chats";
import { EmptyState, ListRow, Screen } from "./layout";
import { workspaceName } from "./ProjectTree";
import { statusOf } from "./status";

const SECTION_LABEL = {
	needsYou: "mobile.chats.needsYou",
	running: "mobile.chats.running",
	done: "mobile.chats.done",
} as const satisfies Record<ChatSection, string>;

/** The Sessions tab: the sessions that need a look — waiting on you, running, then the ones the phone saw finish — across the paired computers; each names its project and workspace. */
export function ChatsScreen({
	controller,
	items,
	multiHost,
	done,
	onClearDone,
	onOpen,
	footer,
}: {
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	/** More than one computer is paired, so a row also names its computer. */
	multiHost: boolean;
	/** Sessions the phone saw finish, newest first. */
	done: readonly string[];
	onClearDone: () => void;
	onOpen: (item: RemoteSessionItem, place: ChatPlace) => void;
	footer: ReactNode;
}) {
	const t = useT();
	const sections = chatSections(items, done);
	const placeOf = useChatPlaces(
		controller,
		sections.flatMap((group) => group.items),
	);
	return (
		<Screen title={t("mobile.chats.title")} surface="sidebar" footer={footer}>
			{sections.length === 0 ? (
				<EmptyState
					icon={RiChat3Line}
					title={t("mobile.chats.emptyTitle")}
					text={t("mobile.chats.empty")}
				/>
			) : (
				<ul data-testid="chats" className="m-0 list-none p-0">
					{sections.flatMap(({ section, items: rows }) => [
						<li
							key={section}
							className="flex items-center justify-between gap-8 pt-16 pb-4 pl-16 text-text-subtle tr-text-eyebrow"
						>
							{t(SECTION_LABEL[section])}
							{section === "done" ? (
								<Button
									variant="ghost"
									className="h-touch -my-12 shrink-0 rounded-md px-16"
									data-testid="done-clear"
									onClick={onClearDone}
								>
									{t("mobile.chats.clearDone")}
								</Button>
							) : null}
						</li>,
						...rows.map((item) => {
							const place = placeOf(item);
							const title = chatTitle(item.record.title, item.record.firstPrompt);
							const where = place
								? `${place.project.name} · ${workspaceName(t, place.workspace)}`
								: undefined;
							return (
								<ListRow
									key={`${item.hostKey}:${item.record.sessionId}`}
									icon={RiChat3Line}
									title={title?.text ?? t("store.chatTab.defaultName")}
									tooltip={title?.tooltip}
									detail={
										multiHost
											? [item.hostLabel, where].filter(Boolean).join(" · ")
											: (where ?? t("mobile.list.loading"))
									}
									status={statusOf(item.record.state)}
									onOpen={() => {
										if (place) onOpen(item, place);
									}}
								/>
							);
						}),
					])}
				</ul>
			)}
		</Screen>
	);
}
