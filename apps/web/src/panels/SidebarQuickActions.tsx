import { RiEditBoxLine, RiSearchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { ButtonIcon } from "@thinkrail/ui/button";
import { useAppStore } from "../store";
import { canStartProjectlessChat, startProjectlessChat } from "./chatActions";
import { startChatInTab } from "./openChat";

const ROW_CLASS =
	"flex h-28 w-full min-w-0 items-center gap-8 rounded-md px-8 tr-text-ui text-text-default transition-colors hover:bg-control-bg-hovered focus-visible:focus-ring-inset disabled:text-control-disabled-text disabled:hover:bg-transparent";

function QuickActionRow({
	icon: Icon,
	label,
	hint,
	disabled,
	onClick,
	...rest
}: {
	icon: ButtonIcon;
	label: string;
	hint?: string | undefined;
	disabled?: boolean;
	onClick: () => void;
	"data-testid": string;
}) {
	return (
		<button type="button" className={ROW_CLASS} disabled={disabled} onClick={onClick} {...rest}>
			<Icon aria-hidden className="size-16 shrink-0 text-text-muted" />
			<span className="min-w-0 flex-1 truncate text-left">{label}</span>
			{hint ? <span className="shrink-0 tr-text-metadata text-text-subtle">{hint}</span> : null}
		</button>
	);
}

/**
 * The Thread Sidebar's leading actions: **New thread** starts the next piece of work where the user
 * is — a sibling chat in the active workspace, the New workspace dialog for the selected project, or a
 * chat without a project — and **Search** opens the search palette. Placement-agnostic: it renders in
 * the Projects tool wherever that tool sits.
 */
export function SidebarQuickActions({
	onNewWorkspace,
	searchShortcut,
}: {
	onNewWorkspace: (projectId: string) => void;
	searchShortcut?: string | undefined;
}) {
	const t = useT();
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const canStartChat = useAppStore(canStartProjectlessChat);
	const canStart = activeWorkspaceId !== null || selectedProjectId !== null || canStartChat;
	const newThread = () => {
		if (activeWorkspaceId) void startChatInTab(activeWorkspaceId);
		else if (selectedProjectId) onNewWorkspace(selectedProjectId);
		else if (canStartChat) void startProjectlessChat();
	};
	return (
		<div data-testid="sidebar-quick-actions" className="flex flex-col gap-2 px-4 pb-8">
			<QuickActionRow
				icon={RiEditBoxLine}
				label={t("panels.sidebar.newThread")}
				disabled={!canStart}
				onClick={newThread}
				data-testid="sidebar-new-thread"
			/>
			<QuickActionRow
				icon={RiSearchLine}
				label={t("panels.sidebar.search")}
				hint={searchShortcut}
				onClick={() => useAppStore.getState().openSearch()}
				data-testid="sidebar-search"
			/>
		</div>
	);
}
