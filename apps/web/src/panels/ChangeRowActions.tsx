import {
	RiArrowDownSLine as ChevronDown,
	RiFileCopyLine as Copy,
	RiFileScanLine as FileDiff,
	RiExternalLinkLine as OpenAsTab,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";
import { copyText } from "@/lib";

export const ROW_MENU_SLOT = "mr-4 size-20 shrink-0";

export function ChangeRowActions({
	path,
	active = false,
	onView,
	onOpenTab,
	children,
}: {
	path: string;
	active?: boolean;
	onView: () => void;
	onOpenTab: () => void;
	children: (rowProps: { onContextMenu: (event: MouseEvent) => void }) => ReactNode;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const onContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		setOpen(true);
	};
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<div
				data-testid="change-row"
				data-row
				data-active={active || open ? true : undefined}
				className={`group flex min-w-0 items-center rounded-sm ${
					active || open ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
				}`}
			>
				{children({ onContextMenu })}
				<DropdownMenuTrigger asChild>
					<IconButton
						size="s"
						icon={ChevronDown}
						label={t("panels.changeRowActions.menuLabel", { path })}
						data-testid="change-row-menu"
						wrapTrigger
						className="mr-4 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
					/>
				</DropdownMenuTrigger>
			</div>
			<DropdownMenuContent align="end" data-testid="change-row-actions">
				<DropdownMenuItem data-testid="change-action-view" onSelect={onView}>
					<FileDiff />
					{t("panels.changeRowActions.review")}
				</DropdownMenuItem>
				<DropdownMenuItem data-testid="change-action-open-tab" onSelect={onOpenTab}>
					<OpenAsTab />
					{t("panels.changeRowActions.openAsTab")}
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="change-action-copy-path"
					onSelect={() => {
						void copyText(path);
					}}
				>
					<Copy />
					{t("panels.changeRowActions.copyPath")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
