import { RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

export function Segment({
	caption,
	children,
	className,
	testid,
}: {
	caption: ReactNode;
	children: ReactNode;
	className?: string | undefined;
	testid?: string | undefined;
}) {
	return (
		<div
			data-testid={testid}
			className={cn(
				"flex h-topbar-row min-w-0 flex-col gap-2 border-border-default border-l py-4 pr-8 pl-12",
				className,
			)}
		>
			<span className="flex h-10 min-w-0 items-baseline gap-4 truncate pl-8 text-text-subtle tr-text-caption leading-none">
				{caption}
			</span>
			<div className="flex h-20 min-w-0 items-center gap-4">{children}</div>
		</div>
	);
}

export const pillClass =
	"window-no-drag inline-flex h-20 min-w-0 items-center gap-4 rounded-[var(--radius-sm)] px-8 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-control-bg-selected data-[state=open]:text-text-default";

export function PillChevron({ className }: { className?: string | undefined }) {
	return (
		<ChevronDown
			aria-hidden="true"
			className={cn("size-14 shrink-0 text-text-subtle", className)}
		/>
	);
}

export type ChipTone = "neutral" | "success" | "warning" | "info";

const CHIP_TONE: Record<ChipTone, { rest: string; hover: string }> = {
	neutral: { rest: "bg-control-bg-selected text-text-muted", hover: "hover:bg-control-bg-hovered" },
	success: {
		rest: "bg-feedback-success-subtle text-feedback-success",
		hover: "hover:bg-feedback-success-muted data-[state=open]:bg-feedback-success-muted",
	},
	warning: {
		rest: "bg-feedback-warning-subtle text-feedback-warning",
		hover: "hover:bg-feedback-warning-muted data-[state=open]:bg-feedback-warning-muted",
	},
	info: {
		rest: "bg-feedback-info-subtle text-feedback-info",
		hover: "hover:bg-feedback-info-muted data-[state=open]:bg-feedback-info-muted",
	},
};

export function chipClass(tone: ChipTone, interactive = false): string {
	return cn(
		"inline-flex h-20 shrink-0 items-center gap-4 whitespace-nowrap rounded-full px-8 tr-text-emphasis [&_svg]:size-12 [&_svg]:shrink-0",
		CHIP_TONE[tone].rest,
		interactive &&
			cn(
				"window-no-drag outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
				CHIP_TONE[tone].hover,
			),
	);
}
