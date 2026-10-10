import { useDraggable } from "@dnd-kit/core";
import { RiCloseLine as X } from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from "react";
import { tupleKey } from "../../lib";
import type { LayoutTab } from "./types";

const TITLE_CLASS =
	"flex min-w-0 flex-1 items-center truncate px-12 tr-title-compact text-text-default";

function DraggableTitle({ title, tab }: { title: string; tab: LayoutTab }) {
	const { setNodeRef, listeners, isDragging } = useDraggable({
		id: tupleKey("dnd-pane-title", tab.id),
		data: { tab },
	});
	return (
		<span
			ref={setNodeRef}
			{...listeners}
			data-testid="auxiliary-pane-title"
			data-dragging={isDragging || undefined}
			className={cn(TITLE_CLASS, "cursor-grab select-none data-[dragging]:cursor-grabbing")}
		>
			{title}
		</span>
	);
}

export const AuxiliaryPaneHeader = forwardRef<
	HTMLDivElement,
	Omit<ComponentPropsWithoutRef<"div">, "children" | "title"> & {
		title: string;
		dragTab?: LayoutTab;
		actions?: ReactNode;
	}
>(function AuxiliaryPaneHeader({ title, dragTab, actions, className, ...props }, ref) {
	return (
		<div
			ref={ref}
			data-testid="auxiliary-pane-header"
			{...props}
			className={cn(
				"relative flex h-panel-header-row shrink-0 items-stretch border-border-muted border-b bg-container-header-bg",
				className,
			)}
		>
			{dragTab ? (
				<DraggableTitle title={title} tab={dragTab} />
			) : (
				<span data-testid="auxiliary-pane-title" className={TITLE_CLASS}>
					{title}
				</span>
			)}
			{actions}
		</div>
	);
});

export function AuxiliaryPaneHideButton({
	controls,
	testId,
	onClick,
}: {
	controls: string;
	testId: string;
	onClick: () => void;
}) {
	return (
		<IconTooltip label="Hide pane">
			<button
				type="button"
				data-testid={testId}
				aria-label="Hide pane"
				aria-controls={controls}
				aria-expanded="true"
				onClick={onClick}
				className="flex w-panel-header-row shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			>
				<X className="size-14" />
			</button>
		</IconTooltip>
	);
}
