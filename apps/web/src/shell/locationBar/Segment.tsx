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
			className={cn("flex min-w-0 flex-col justify-center pl-8", className)}
		>
			<span className="flex h-topbar-caption min-w-0 items-center gap-4 truncate pl-8 text-text-subtle tr-text-metadata">
				{caption}
			</span>
			<div className="flex h-topbar-value min-w-0 items-center gap-4">{children}</div>
		</div>
	);
}

export const pillClass =
	"group/pill window-no-drag inline-flex h-topbar-value min-w-0 items-center gap-4 rounded-sm px-8 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-control-bg-selected data-[state=open]:text-text-default";

export function PillChevron({ className }: { className?: string | undefined }) {
	return (
		<ChevronDown
			aria-hidden="true"
			className={cn(
				"size-14 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover/pill:opacity-100 group-focus-visible/pill:opacity-100 group-data-[state=open]/pill:opacity-100",
				className,
			)}
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
		"inline-flex h-topbar-value shrink-0 items-center gap-4 whitespace-nowrap rounded-full px-8 tr-text-emphasis [&_svg]:size-12 [&_svg]:shrink-0",
		CHIP_TONE[tone].rest,
		interactive &&
			cn(
				"window-no-drag outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
				CHIP_TONE[tone].hover,
			),
	);
}

export type SplitTone = "primary" | "warning" | "neutral";

const SPLIT_TONE: Record<SplitTone, { frame: string; hover: string }> = {
	primary: {
		frame: "border-primary-soft bg-primary-subtle text-primary",
		hover: "hover:bg-primary-soft data-[state=open]:bg-primary-soft",
	},
	warning: {
		frame: "border-feedback-warning-muted bg-feedback-warning-subtle text-feedback-warning",
		hover: "hover:bg-feedback-warning-muted data-[state=open]:bg-feedback-warning-muted",
	},
	neutral: {
		frame: "border-control-border-default text-text-muted",
		hover:
			"hover:bg-control-bg-hovered hover:text-text-default data-[state=open]:bg-control-bg-selected",
	},
};

export function splitFrameClass(tone: SplitTone): string {
	return cn(
		"inline-flex h-topbar-value shrink-0 items-stretch overflow-hidden rounded-sm border",
		SPLIT_TONE[tone].frame,
	);
}

export function splitPartClass(tone: SplitTone): string {
	return cn(
		"window-no-drag flex items-center gap-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-60 [&_svg]:size-12 [&_svg]:shrink-0",
		SPLIT_TONE[tone].hover,
	);
}
