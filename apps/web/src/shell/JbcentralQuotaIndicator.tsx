import { RiCoinsLine as Coins, RiLoader4Line as Loader } from "@remixicon/react";
import type { JbcentralQuotaSnapshot } from "@thinkrail/contracts";
import { IconTooltip } from "@/components/ui/tooltip";
import { formatJbcentralQuota } from "./jbcentralQuota";

export type JbcentralQuotaViewSnapshot = JbcentralQuotaSnapshot | { state: "loading" };

function observedLabel(observedAt: number): string {
	return new Date(observedAt).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function JbcentralQuotaIndicator({
	snapshot,
	onRetry,
}: {
	snapshot: JbcentralQuotaViewSnapshot;
	onRetry: () => void;
}) {
	if (snapshot.state === "hidden") return null;
	if (snapshot.state === "loading") {
		return (
			<IconTooltip label="Reading recurring JetBrains AI quota">
				<span
					data-testid="jbcentral-quota"
					data-state="loading"
					className="inline-flex shrink-0 items-center gap-4 whitespace-nowrap text-text-muted tr-text-ui"
				>
					<Loader className="size-14 animate-spin" aria-hidden="true" />
					<span>Loading quota…</span>
				</span>
			</IconTooltip>
		);
	}
	if (snapshot.state === "unavailable") {
		return (
			<IconTooltip label="Central is connected, but quota could not be read">
				<button
					type="button"
					data-testid="jbcentral-quota"
					data-state="unavailable"
					onClick={onRetry}
					className="inline-flex shrink-0 items-center gap-4 whitespace-nowrap rounded-[var(--radius-sm)] text-text-muted tr-text-ui outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					<Coins className="size-14" aria-hidden="true" />
					<span>Quota unavailable</span>
					<span className="hidden sm:inline">· Retry</span>
				</button>
			</IconTooltip>
		);
	}

	const value = formatJbcentralQuota(snapshot.remaining, snapshot.total);
	const stale = snapshot.state === "stale";
	const content = (
		<>
			<Coins className="size-14 text-text-muted" aria-hidden="true" />
			<span>{value}</span>
			<span className="hidden sm:inline">credits</span>
			{stale ? (
				<span
					data-testid="jbcentral-quota-stale-marker"
					className="size-6 rounded-full bg-feedback-warning"
					aria-hidden="true"
				/>
			) : null}
		</>
	);
	const label = `${value} recurring JetBrains AI credits${
		stale ? ", stale — retry" : `, updated ${observedLabel(snapshot.observedAt)}`
	}`;
	const className =
		"inline-flex shrink-0 items-center gap-4 whitespace-nowrap text-text-default tr-text-ui";

	return (
		<IconTooltip
			label={
				stale
					? `Last successful quota read: ${observedLabel(snapshot.observedAt)} · Click to retry`
					: `Recurring JetBrains AI credits · Updated ${observedLabel(snapshot.observedAt)}`
			}
		>
			{stale ? (
				<button
					type="button"
					data-testid="jbcentral-quota"
					data-state="stale"
					aria-label={label}
					onClick={onRetry}
					className={`${className} rounded-[var(--radius-sm)] outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary`}
				>
					{content}
				</button>
			) : (
				<span data-testid="jbcentral-quota" data-state="available" className={className}>
					{content}
				</span>
			)}
		</IconTooltip>
	);
}
