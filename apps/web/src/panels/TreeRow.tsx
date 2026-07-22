import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One row of a file-style tree — the single source of the tree-row look (row height, hover, the
 * chevron-or-spacer lead, the folder/file icon, the truncated label, a trailing slot). Shared by the
 * `FileTree` (All files) and the `ChangesTree` (Changes → folders) so the two trees stay pixel-identical;
 * a style tweak lands in both at once.
 *
 * `kind` drives both the lead (dirs get a chevron reflecting `expanded`, files get a spacer) and the icon
 * (folder vs file). Callers own behaviour (`onClick`/`onDoubleClick`) and the right-hand `trailing` slot
 * (e.g. status glyph + `DiffStatBadge`). Indentation is the caller's nested `pl-md` lists, not this row.
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
			className={`flex h-6 w-full items-center gap-xs rounded-[var(--radius-sm)] px-xs text-left text-sm text-muted hover:bg-hover ${
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
