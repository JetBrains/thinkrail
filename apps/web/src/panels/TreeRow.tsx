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
 *
 * `highlight` says **who paints** the hover/selected band. `"self"` (the default, what the All-files tree
 * wants) is this row; `"wrapper"` is for a row nested inside something that owns a wider band — the Changes
 * tree's `ChangeRowActions`, whose band must also cover the trailing ⌄ slot. Exactly one painter, always:
 * two would make the row read as cut off at this button's edge, and would mask a wrapper that stopped
 * painting at all.
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
	highlight = "self",
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
	/** Who paints the hover/selected band: this row (default) or an enclosing wrapper. */
	highlight?: "self" | "wrapper";
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
			className={`flex h-6 w-full min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs text-left tr-text-ui text-text-muted ${
				highlight === "self"
					? `hover:bg-control-bg-hovered ${active ? "bg-control-bg-hovered" : ""}`
					: ""
			}`}
		>
			{kind === "dir" ? (
				<Chevron className="size-3.5 shrink-0 text-text-subtle" />
			) : (
				<span className="size-3.5 shrink-0" />
			)}
			{kind === "dir" ? (
				<Folder className="size-4 shrink-0 text-text-subtle" />
			) : (
				<FileIcon className="size-4 shrink-0 text-text-subtle" />
			)}
			<span className={`min-w-0 flex-1 truncate ${labelClassName ?? ""}`}>{label}</span>
			{trailing}
		</button>
	);
}
