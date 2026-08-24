import type { ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from "../components/ui/popover";
import { useTargetRect } from "./anchor";

const DIM = "pointer-events-auto fixed z-40 bg-container-workspace-overlay";

export function Spotlight({
	selector,
	side = "bottom",
	align = "start",
	children,
}: {
	selector: string;
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	children: ReactNode;
}) {
	const rect = useTargetRect(selector);
	if (!rect) return null;
	return (
		<>
			<div
				aria-hidden
				className={DIM}
				style={{ left: 0, top: 0, width: "100vw", height: rect.top }}
			/>
			<div
				aria-hidden
				className={DIM}
				style={{
					left: 0,
					top: rect.bottom,
					width: "100vw",
					height: `calc(100vh - ${rect.bottom}px)`,
				}}
			/>
			<div
				aria-hidden
				className={DIM}
				style={{ left: 0, top: rect.top, width: rect.left, height: rect.height }}
			/>
			<div
				aria-hidden
				className={DIM}
				style={{
					left: rect.right,
					top: rect.top,
					width: `calc(100vw - ${rect.right}px)`,
					height: rect.height,
				}}
			/>
			<Popover open>
				<PopoverAnchor asChild>
					<div
						aria-hidden
						className="pointer-events-none fixed z-40"
						style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
					/>
				</PopoverAnchor>
				<PopoverContent
					data-testid="onboarding-coach"
					side={side}
					align={align}
					className="z-50 w-[280px] p-md"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
				>
					{children}
					<PopoverArrow />
				</PopoverContent>
			</Popover>
		</>
	);
}

export function CoachBody({
	step,
	title,
	body,
	action,
}: {
	step: number;
	title: string;
	body: string;
	action?: ReactNode;
}) {
	return (
		<>
			<p className="tr-text-label-pill text-primary">Step {step} of 4</p>
			<p className="mt-xs tr-title-card text-text-default">{title}</p>
			<p className="mt-xs text-text-muted tr-text-metadata leading-snug">{body}</p>
			{action ? <div className="mt-md flex items-center justify-end">{action}</div> : null}
		</>
	);
}
