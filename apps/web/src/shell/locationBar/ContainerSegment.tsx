import {
	RiCheckLine as Check,
	RiGitBranchLine as GitBranch,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiSparkling2Line,
	RiStackLine,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { RunningIcon } from "../../components/RunningIcon";
import { memberSubtitle, renameContainer } from "../../panels/containerActions";
import { useInlineRename } from "../../panels/workspaceActions";
import {
	selectContainerGroup,
	selectWorkspaceIsRunning,
	useAppStore,
	workspaceName,
} from "../../store";
import { PillChevron, pillClass, Segment } from "./Segment";

/** The topbar's `Container ▾` for a member or the orchestrator: switch among them, add, rename, remove. */
export function ContainerSegment({
	containerId,
	activeWorkspaceId,
}: {
	containerId: string;
	activeWorkspaceId: string;
}) {
	const t = useT();
	const containers = useAppStore((s) => s.containers);
	const projects = useAppStore((s) => s.projects);
	const workspaces = useAppStore((s) => s.workspaces);
	const sessionStateByWorkspace = useAppStore((s) => s.sessionStateByWorkspace);
	const group = selectContainerGroup({ containers, projects, workspaces }, containerId);
	const container = group?.container ?? null;
	const {
		editing,
		nameRef,
		start: startRename,
		inputProps,
		onMenuCloseAutoFocus,
	} = useInlineRename({ target: container, canRename: true, onRename: renameContainer });
	if (!group || !container) return null;
	const multiProject = group.projectId === null;
	const projectName = (projectId: string) =>
		projects.find((project) => project.id === projectId)?.name ?? "";
	const open = (kind: "addWorkspace" | "remove") =>
		useAppStore.getState().openContainerDialog({ kind, containerId });
	return (
		<Segment
			caption={t("containers.caption")}
			testid="scope-container-segment"
			className="hidden max-w-[220px] shrink-[3] pl-0 sm:flex"
		>
			{editing ? (
				<input
					ref={nameRef}
					data-testid="scope-container-name"
					data-editing
					type="text"
					spellCheck={false}
					aria-label={t("containers.nameInput")}
					defaultValue={container.name}
					{...inputProps}
					className="window-no-drag h-20 w-full min-w-0 truncate rounded-sm border-0 bg-control-bg px-8 text-text-default tr-title-section ring-1 ring-control-border-active focus-visible:focus-ring"
				/>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger
						data-testid="scope-container"
						aria-label={t("containers.segmentLabel", { name: container.name })}
						className={pillClass}
					>
						<RiStackLine aria-hidden="true" className="size-14 shrink-0" />
						<span data-testid="scope-container-name" className="truncate tr-title-section">
							{container.name}
						</span>
						<PillChevron />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						data-testid="scope-container-menu"
						onCloseAutoFocus={onMenuCloseAutoFocus}
					>
						<DropdownMenuLabel className="truncate">{container.name}</DropdownMenuLabel>
						{group.members.map((member) => {
							const active = member.id === activeWorkspaceId;
							const running = selectWorkspaceIsRunning({ sessionStateByWorkspace }, member.id);
							const subtitle = memberSubtitle(
								t,
								member,
								multiProject ? projectName(member.projectId) : undefined,
							);
							return (
								<DropdownMenuItem
									key={member.id}
									data-testid="scope-container-member"
									data-active={active || undefined}
									onSelect={() => useAppStore.getState().activateWorkspace(member)}
								>
									{active ? (
										<Check className="text-primary" />
									) : running ? (
										<RunningIcon className="size-14 text-primary" />
									) : (
										<GitBranch />
									)}
									<span className="truncate">{workspaceName(t, member)}</span>
									{subtitle ? (
										<span className="ml-auto truncate pl-8 text-text-subtle tr-text-metadata">
											{subtitle}
										</span>
									) : null}
								</DropdownMenuItem>
							);
						})}
						{group.orchestrator ? (
							<DropdownMenuItem
								data-testid="scope-container-orchestrator"
								data-active={group.orchestrator.id === activeWorkspaceId || undefined}
								onSelect={() => {
									if (group.orchestrator)
										useAppStore.getState().activateWorkspace(group.orchestrator);
								}}
							>
								{group.orchestrator.id === activeWorkspaceId ? (
									<Check className="text-primary" />
								) : (
									<RiSparkling2Line />
								)}
								<span className="truncate">{t("containers.orchestrator")}</span>
							</DropdownMenuItem>
						) : null}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							data-testid="scope-container-add"
							onSelect={() => open("addWorkspace")}
						>
							<Plus />
							{t("containers.addWorkspace")}
						</DropdownMenuItem>
						<DropdownMenuItem data-testid="scope-container-rename" onSelect={startRename}>
							<Pencil />
							{t("common.rename")}
						</DropdownMenuItem>
						<DropdownMenuItem
							data-testid="scope-container-remove"
							className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
							onSelect={() => open("remove")}
						>
							<Trash2 />
							{t("containers.remove")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</Segment>
	);
}
