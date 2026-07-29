import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

/**
 * One row of a file-style tree — the single source of the tree-row look (row height, hover, the
 * chevron-or-spacer lead, the folder/file icon, the truncated label, a trailing slot). Shared by the
 * `FileTree` (All files) and the `ChangesTree` (Changes → folders) so the two trees stay pixel-identical;
 * a style tweak lands in both at once.
 *
 * `kind` drives both the lead (dirs get a chevron reflecting `expanded`, files get a spacer) and the icon
 * (folder vs file). Callers own behaviour (`onClick`/`onDoubleClick`/`onContextMenu` — the Changes tree hangs
 * its row action menu off the last one) and the right-hand `trailing` slot (e.g. status glyph +
 * `DiffStatBadge`). Indentation is the caller's nested `pl-md` lists, not this row.
 */
export function TreeRow({
	testid,
	kind,
	expanded,
	active,
	dataStatus,
	label,
	labelClassName,
	trailing,
	onClick,
	onDoubleClick,
	onContextMenu,
}: {
	testid: string;
	kind: "dir" | "file";
	expanded?: boolean;
	active?: boolean;
	dataStatus?: string;
	label: string;
	/** Extra classes for the label span (e.g. a status color / strikethrough); overrides the row default. */
	labelClassName?: string;
	trailing?: ReactNode;
	onClick?: (() => void) | undefined;
	onDoubleClick?: (() => void) | undefined;
	onContextMenu?: ((event: MouseEvent) => void) | undefined;
}) {
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<button
			type="button"
			data-testid={testid}
			data-kind={kind}
			data-active={active ? true : undefined}
			data-status={dataStatus}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
			// `min-w-0` so the row can shrink below its label's width when it shares a flex line with a
			// trailing control (the Changes tree's row-menu slot) — otherwise a long file name pushes that
			// control out and the `+N −M` column stops lining up with the folder rows'.
			className={`flex h-6 w-full min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs text-left text-sm text-muted hover:bg-hover ${
				active ? "bg-hover" : ""
			}`}
		>
			{kind === "dir" ? (
				<Chevron className="size-3.5 shrink-0 text-hint" />
			) : (
				<span className="size-3.5 shrink-0" />
			)}
			{kind === "dir" ? (
				<Folder className="size-4 shrink-0 text-hint" />
			) : (
				<FileIcon className="size-4 shrink-0 text-hint" />
			)}
			<span className={`min-w-0 flex-1 truncate ${labelClassName ?? ""}`}>{label}</span>
			{trailing}
		</button>
	);
}
