import {
	RiFolderLine as Folder,
	RiGlobalLine as Globe,
	RiSparkling2Line as Sparkles,
} from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import type { ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AddProjectMenu({
	recentProjects,
	onOpen,
	onCreate,
	onOpenRecent,
	align = "end",
	children,
}: {
	recentProjects: Project[];
	onOpen: () => void;
	onCreate: () => void;
	onOpenRecent: (path: string) => void;
	align?: "start" | "center" | "end";
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				<DropdownMenuItem data-testid="menu-create-project" onSelect={() => onCreate()}>
					<Sparkles />
					<span>New project from scratch</span>
				</DropdownMenuItem>
				<DropdownMenuItem data-testid="menu-open-project" onSelect={() => onOpen()}>
					<Folder />
					<span>Open existing project</span>
				</DropdownMenuItem>
				<DropdownMenuItem disabled>
					<Globe />
					<span>Open GitHub project</span>
				</DropdownMenuItem>
				{recentProjects.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Recents</DropdownMenuLabel>
						<DropdownMenuGroup>
							{recentProjects.map((project) => (
								<DropdownMenuItem
									key={project.id}
									onSelect={() => onOpenRecent(project.path)}
									title={project.path}
								>
									<Folder />
									<span className="truncate">{project.path}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
