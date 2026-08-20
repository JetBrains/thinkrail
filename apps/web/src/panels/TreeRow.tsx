import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

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
	labelClassName?: string;
	trailing?: ReactNode;
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
			className={`flex h-6 w-full min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs text-left tr-text-ui text-text-muted ${
				highlight === "self"
					? `hover:bg-control-bg-hovered ${active ? "bg-control-bg-selected" : ""}`
					: ""
			}`}
		>
			{kind === "dir" ? (
				<Chevron className="size-3.5 shrink-0 text-text-muted" />
			) : (
				<span className="size-3.5 shrink-0" />
			)}
			{kind === "dir" ? (
				<Folder className="size-4 shrink-0 text-text-muted" />
			) : (
				<FileIcon className="size-4 shrink-0 text-text-muted" />
			)}
			<span className={`min-w-0 flex-1 truncate ${labelClassName ?? ""}`}>{label}</span>
			{trailing}
		</button>
	);
}
