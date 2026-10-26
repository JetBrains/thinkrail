import { RiCheckLine as Check, RiHome2Line as House, RiAddLine as Plus } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useShallow } from "zustand/react/shallow";
import { startProjectlessChat } from "../../panels/chatActions";
import { useOpenProject } from "../../panels/useOpenProject";
import { goToProjectHome } from "../../panels/workspaceActions";
import {
	isChatsContainer,
	selectChatsContainer,
	selectChatWorkspaces,
	selectRepoProjects,
	supportsProjectlessChats,
	useAppStore,
} from "../../store";
import { projectInitial } from "./locationModel";
import { PillChevron, pillClass, Segment } from "./Segment";

export function ProjectSegment({ project, atHome }: { project: Project; atHome: boolean }) {
	const t = useT();
	const projects = useAppStore(useShallow(selectRepoProjects));
	const chatsContainer = useAppStore((s) =>
		supportsProjectlessChats(s.protocolVersion) ? selectChatsContainer(s) : null,
	);
	const isChats = isChatsContainer(project);
	const { pickAndOpen, dialogs } = useOpenProject((opened) => goToProjectHome(opened.id));
	const goToChats = () => {
		const newest = selectChatWorkspaces(useAppStore.getState())[0];
		if (newest) useAppStore.getState().activateWorkspace(newest);
		else void startProjectlessChat();
	};
	return (
		<Segment
			caption={t("shell.location.project.caption")}
			testid="scope-project-segment"
			className="hidden max-w-[220px] shrink-[3] pl-0 sm:flex"
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="scope-project"
					aria-label={t("shell.location.project.label", { name: project.name })}
					className={pillClass}
				>
					<span
						aria-hidden="true"
						className="inline-flex size-16 shrink-0 items-center justify-center rounded-sm bg-control-bg-selected text-text-muted tr-text-caption"
					>
						{projectInitial(project.name)}
					</span>
					<span data-testid="scope-project-name" className="truncate tr-title-section">
						{project.name}
					</span>
					<PillChevron />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" data-testid="scope-project-menu">
					<DropdownMenuLabel>{t("shell.location.project.menuTitle")}</DropdownMenuLabel>
					{chatsContainer ? (
						<DropdownMenuItem
							data-testid="scope-project-chats"
							data-active={isChats || undefined}
							onSelect={goToChats}
						>
							<span className="flex w-14 shrink-0 justify-center">
								{isChats ? <Check className="text-primary" /> : null}
							</span>
							<span className="truncate">{t("shell.locationBar.chats")}</span>
						</DropdownMenuItem>
					) : null}
					{projects.map((candidate) => (
						<DropdownMenuItem
							key={candidate.id}
							data-testid="scope-project-option"
							data-active={candidate.id === project.id || undefined}
							onSelect={() => goToProjectHome(candidate.id)}
						>
							<span className="flex w-14 shrink-0 justify-center">
								{candidate.id === project.id ? <Check className="text-primary" /> : null}
							</span>
							<span className="truncate">{candidate.name}</span>
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					{isChats ? null : (
						<DropdownMenuItem
							data-testid="scope-project-home"
							disabled={atHome}
							onSelect={() => goToProjectHome(project.id)}
						>
							<House />
							{t("shell.location.project.home")}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem data-testid="scope-project-add" onSelect={() => void pickAndOpen()}>
						<Plus />
						{t("shell.location.project.add")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{dialogs}
		</Segment>
	);
}
