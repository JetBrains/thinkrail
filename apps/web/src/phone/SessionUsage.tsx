import { contextPart, usageParts } from "@thinkrail/chat-ui/SessionStatsBar";
import type { SessionStats } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";

/**
 * The IDE chat toolbar as a strip under the phone's header on the chat background: one centered line with a slim
 * context meter, how full it is and the billed parts (↑ ↓ R W $); a tap opens the toolbar's buttons under it.
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
	/** The toolbar's buttons (Resources, Skills), shown while open. */
	children: ReactNode;
}) {
	const t = useT();
	if (!stats) return null;
	const parts = usageParts(stats);
	const usage = stats.contextUsage;
	return (
		<div className="flex shrink-0 flex-col border-b border-border-muted bg-container-workspace-bg">
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
				<div
					data-testid="session-toolbar"
					className="flex items-center justify-center gap-8 px-chat-gutter pb-8"
				>
					{children}
				</div>
			) : null}
		</div>
	);
}
