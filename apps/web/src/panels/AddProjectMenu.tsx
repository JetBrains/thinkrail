import {
	RiEditLine as Edit,
	RiFolderLine as Folder,
	RiGlobalLine as Globe,
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
	onEnterHostPath,
	onOpenRecent,
	align = "end",
	children,
}: {
	recentProjects: Project[];
	onOpen: () => void;
	onEnterHostPath: () => void;
	onOpenRecent: (path: string) => void;
	align?: "start" | "center" | "end";
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				<DropdownMenuItem data-testid="menu-open-project" onSelect={() => onOpen()}>
					<Folder />
					<span>Open project</span>
				</DropdownMenuItem>
				<DropdownMenuItem data-testid="menu-enter-host-path" onSelect={() => onEnterHostPath()}>
					<Edit />
					<span>Enter host path…</span>
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
