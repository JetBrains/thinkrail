import { RiErrorWarningLine, RiStackFill, RiStackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, type ButtonIcon, IconButton } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import type { ComponentProps } from "react";

function breathing(Icon: ButtonIcon): ButtonIcon {
	return function BreathingIcon({ className, ...props }) {
		return <Icon {...props} className={cn(className, "motion-safe:animate-working")} />;
	};
}

const StackFillLive = breathing(RiStackFill);
const StackLineLive = breathing(RiStackLine);

export function ResourcesButton({
	activeCount,
	freshCount = 0,
	open,
	working,
	className,
	...props
}: ComponentProps<typeof Button> & {
	activeCount: number | null;
	freshCount?: number;
	open: boolean;
	working?: boolean;
}) {
	const t = useT();
	const live = working ?? (activeCount !== null && activeCount > 0);
	const Icon = open ? (live ? StackFillLive : RiStackFill) : live ? StackLineLive : RiStackLine;
	return (
		<IconTooltip
			label={
				activeCount === null
					? t("resources.button.tooltipUnavailable")
					: t("resources.button.label")
			}
			wrapTrigger
		>
			<Button
				variant="ghost"
				size="m"
				iconLeft={Icon}
				selected={open}
				className={cn("shrink-0", className)}
				data-testid="resources-trigger"
				data-active-count={activeCount ?? "unknown"}
				data-live={live || undefined}
				data-fresh-count={freshCount || undefined}
				aria-label={
					activeCount === null
						? t("resources.button.ariaUnavailable")
						: freshCount > 0
							? t("resources.button.ariaActiveFresh", { count: activeCount, fresh: freshCount })
							: t("resources.button.ariaActive", { count: activeCount })
				}
				aria-expanded={open}
				{...props}
			>
				<span className="hidden @[480px]:inline">{t("resources.button.label")}</span>
				<span className="tabular-nums">{activeCount ?? "—"}</span>
				{freshCount > 0 ? (
					<span
						data-testid="resources-trigger-fresh"
						className="inline-flex items-center rounded-full bg-primary-subtle px-4 tr-text-label-pill text-primary tabular-nums"
					>
						{t("resources.button.fresh", { count: freshCount })}
					</span>
				) : null}
			</Button>
		</IconTooltip>
	);
}

export function ResourcesAttention({ count, onOpen }: { count: number; onOpen: () => void }) {
	const t = useT();
	const label = t("resources.attention.label", { count });
	return (
		<IconButton
			variant="ghost"
			size="m"
			icon={RiErrorWarningLine}
			label={label}
			data-testid="resources-mcp-attention"
			data-count={count}
			onClick={onOpen}
			className="shrink-0 text-feedback-warning hover:text-feedback-warning"
		/>
	);
}
