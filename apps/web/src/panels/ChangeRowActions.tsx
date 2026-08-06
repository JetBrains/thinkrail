import { ChevronDown, Copy, FileDiff } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib";

/**
 * The width the row-menu `⌄` occupies at a row's trailing edge. Exported because rows **without** a menu
 * (folders) must reserve the same gutter — otherwise their `+N −M` badges sit further right than the file
 * rows' and the column stops lining up.
 */
export const ROW_MENU_SLOT = "mr-xs size-5 shrink-0";

/**
 * A changed-file row's **action menu** — one definition behind two triggers: a hover/focus-revealed `⌄`
 * button in the row's trailing slot *and* right-click on the row itself. The `⌄` is not garnish: it is the
 * **touch path**, where no right-click exists (the app is mobile-first), so both must open the same menu.
 *
 * Read-only by decision: **View** (open/focus this file's diff tab — the same action a plain click performs)
 * and **Copy path** (worktree-relative — the portable escape hatch a remote/phone client can actually use,
 * where a host-side "open in ‹app›" would be silently wrong). No discard: the panel mutates nothing.
 *
 * It **wraps** the row (the `⌄` trigger must be a *sibling* of the row's own button — a button inside a
 * button is invalid) and hands the right-click handler back through a render prop, so the handler lands on
 * the row's real interactive element rather than a bare div. Folder rows get no menu at all — nothing in the
 * item list applies to a folder (they only reserve {@link ROW_MENU_SLOT}).
 *
 * **The wrapper owns the row's highlight**, not the inner button: the band has to span the trailing slot too,
 * or a hovered/selected row reads as visually cut off before its own menu. It stays lit while the menu is
 * open, so the row a menu belongs to is never ambiguous.
 */
export function ChangeRowActions({
	path,
	active = false,
	onView,
	children,
}: {
	/** Worktree-relative path of the row's file — what Copy path writes. */
	path: string;
	/** Whether this row is the selected one (its diff tab is active, or it's the deep-link highlight). */
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
					<ChevronDown className="size-4" />
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
