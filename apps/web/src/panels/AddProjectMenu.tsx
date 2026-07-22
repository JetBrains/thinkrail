import type { ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROJECT_ACTIONS, type ProjectActionId } from "./projectActions";

/**
 * The single project-actions dropdown — exactly the three unified actions (Open local project / Clone
 * from GitHub / Create new project, order from `PROJECT_ACTIONS`); no "Recents". The **trigger is
 * supplied by the caller** (`children`, via Radix `asChild`) — the PROJECTS-header folder-plus button.
 * `onAction(id)` opens the matching (mocked) dialog. `min-w-0` lets the menu hug its content instead of
 * the default `min-w-[12rem]`.
 */
export function AddProjectMenu({
	onAction,
	align = "end",
	children,
}: {
	onAction: (id: ProjectActionId) => void;
	align?: "start" | "center" | "end";
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent align={align} className="min-w-0">
				{PROJECT_ACTIONS.map((action) => (
					<DropdownMenuItem
						key={action.id}
						data-testid={`menu-project-${action.id}`}
						onSelect={() => onAction(action.id)}
					>
						<action.icon />
						<span className="whitespace-nowrap">{action.label}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
