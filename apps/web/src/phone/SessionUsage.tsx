import { contextPart, usageParts } from "@thinkrail/chat-ui/SessionStatsBar";
import type { SessionStats } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

/**
 * The IDE chat toolbar as a strip under the phone's header on the chat background: one centered line with a slim
 * context meter, how full it is and the billed parts (↑ ↓ R W $); a tap opens the toolbar's buttons under it.
 * Until the chat's stats arrive there is no line to tap, so the strip shows the buttons themselves.
 */
export function UsageBar({
	stats,
	open,
	onToggle,
	children,
}: {
	stats: SessionStats | null;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	const t = useT();
	const strip = "flex shrink-0 flex-col border-b border-border-muted bg-container-workspace-bg";
	const toolbar = "flex items-center justify-center gap-8 px-chat-gutter";
	if (!stats)
		return (
			<div className={strip}>
				<div data-testid="session-toolbar" className={cn(toolbar, "min-h-touch")}>
					{children}
				</div>
			</div>
		);
	const parts = usageParts(stats);
	const usage = stats.contextUsage;
	return (
		<div className={strip}>
			<button
				type="button"
				data-testid="session-stats"
				aria-expanded={open}
				title={t("chat.stats.usageLegend")}
				onClick={onToggle}
				className="flex min-h-touch w-full min-w-0 items-center justify-center gap-8 border-0 bg-transparent px-chat-gutter text-text-muted tr-text-metadata active:bg-control-bg-hovered"
			>
				{usage ? (
					<meter
						min={0}
						max={100}
						value={usage.percent ?? 0}
						aria-label={t("chat.stats.contextUsed")}
						className="h-4 w-48 shrink-0 appearance-none overflow-hidden rounded-full bg-border-default [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-border-default [&::-webkit-meter-bar]:bg-none [&::-webkit-meter-optimum-value]:rounded-full [&::-webkit-meter-optimum-value]:bg-primary [&::-webkit-meter-optimum-value]:bg-none"
					/>
				) : null}
				<span className="min-w-0 truncate tabular-nums">
					{[...(usage ? [contextPart(usage).text] : []), ...parts].join(" · ")}
				</span>
			</button>
			{open ? (
				<div data-testid="session-toolbar" className={cn(toolbar, "pb-8")}>
					{children}
				</div>
			) : null}
		</div>
	);
}
