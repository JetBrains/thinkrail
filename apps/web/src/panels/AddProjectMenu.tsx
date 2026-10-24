import {
	RiEditLine as Edit,
	RiFolderLine as Folder,
	RiGlobalLine as Globe,
} from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import type { ReactNode } from "react";

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
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				<DropdownMenuItem data-testid="menu-open-project" onSelect={() => onOpen()}>
					<Folder />
					<span>{t("panels.addProject.open")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem data-testid="menu-enter-host-path" onSelect={() => onEnterHostPath()}>
					<Edit />
					<span>{t("panels.addProject.enterHostPath")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem disabled>
					<Globe />
					<span>{t("panels.addProject.openGitHub")}</span>
				</DropdownMenuItem>
				{recentProjects.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>{t("panels.addProject.recents")}</DropdownMenuLabel>
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
