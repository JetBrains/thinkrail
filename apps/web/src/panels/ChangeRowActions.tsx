import {
	RiArrowDownSLine as ChevronDown,
	RiFileCopyLine as Copy,
	RiFileScanLine as FileDiff,
} from "@remixicon/react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib";

export const ROW_MENU_SLOT = "mr-4 size-20 shrink-0";

export function ChangeRowActions({
	path,
	active = false,
	onView,
	children,
}: {
	path: string;
	active?: boolean;
	onView: () => void;
	children: (rowProps: { onContextMenu: (event: MouseEvent) => void }) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const onContextMenu = (event: MouseEvent) => {
		event.preventDefault();
		setOpen(true);
	};
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<div
				data-testid="change-row"
				data-active={active || open ? true : undefined}
				className={`group flex min-w-0 items-center rounded-[var(--radius-sm)] ${
					active || open ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
				}`}
			>
				{children({ onContextMenu })}
				<DropdownMenuTrigger
					data-testid="change-row-menu"
					aria-label={`Actions for ${path}`}
					className={`${ROW_MENU_SLOT} flex items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-0 outline-none transition hover:bg-container-elevated-bg hover:text-text-default focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 data-[state=open]:opacity-100`}
				>
					<ChevronDown className="size-16" />
				</DropdownMenuTrigger>
			</div>
			<DropdownMenuContent align="end" data-testid="change-row-actions">
				<DropdownMenuItem data-testid="change-action-view" onSelect={onView}>
					<FileDiff />
					View
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="change-action-copy-path"
					onSelect={() => {
						void copyText(path);
					}}
				>
					<Copy />
					Copy path
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
