import { RiCheckLine as Check, RiHome2Line as House, RiAddLine as Plus } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useOpenProject } from "../../panels/useOpenProject";
import { loadProjectWorkspaces } from "../../panels/workspaceActions";
import { useAppStore } from "../../store";
import { projectInitial } from "./locationModel";
import { PillChevron, pillClass, Segment } from "./Segment";

function goToProjectHome(projectId: string): void {
	useAppStore.getState().selectProject(projectId, { reveal: true });
	void loadProjectWorkspaces(projectId).catch(() => {});
}

export function ProjectSegment({ project, atHome }: { project: Project; atHome: boolean }) {
	const projects = useAppStore((s) => s.projects);
	const { pickAndOpen, dialogs } = useOpenProject((opened) => goToProjectHome(opened.id));
	return (
		<Segment
			caption="Project"
			testid="scope-project-segment"
			className="hidden max-w-[220px] shrink-[3] border-l-0 pl-0 sm:flex"
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="scope-project"
					aria-label={`Project ${project.name}`}
					className={pillClass}
				>
					<span
						aria-hidden="true"
						className="inline-flex size-16 shrink-0 items-center justify-center rounded-sm bg-primary-soft text-primary tr-text-caption"
					>
						{projectInitial(project.name)}
					</span>
					<span data-testid="scope-project-name" className="truncate tr-text-ui">
						{project.name}
					</span>
					<PillChevron />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" data-testid="scope-project-menu">
					<DropdownMenuLabel>Projects</DropdownMenuLabel>
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
					<DropdownMenuItem
						data-testid="scope-project-home"
						disabled={atHome}
						onSelect={() => goToProjectHome(project.id)}
					>
						<House />
						Project home
					</DropdownMenuItem>
					<DropdownMenuItem data-testid="scope-project-add" onSelect={() => void pickAndOpen()}>
						<Plus />
						Add project…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{dialogs}
		</Segment>
	);
}
