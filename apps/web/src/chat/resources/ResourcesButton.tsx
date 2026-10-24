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
	open,
	working,
	className,
	...props
}: ComponentProps<typeof Button> & {
	activeCount: number | null;
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
				aria-label={
					activeCount === null
						? t("resources.button.ariaUnavailable")
						: t("resources.button.ariaActive", { count: activeCount })
				}
				aria-expanded={open}
				{...props}
			>
				<span className="hidden @[480px]:inline">{t("resources.button.label")}</span>
				<span className="tabular-nums">{activeCount ?? "—"}</span>
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
