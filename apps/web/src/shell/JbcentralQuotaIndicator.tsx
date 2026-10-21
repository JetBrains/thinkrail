import { RiCoinsLine as Coins, RiLoader4Line as Loader } from "@remixicon/react";
import type { JbcentralQuotaSnapshot } from "@thinkrail/contracts";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { formatJbcentralQuota } from "./jbcentralQuota";

export type JbcentralQuotaViewSnapshot = JbcentralQuotaSnapshot | { state: "loading" };

function observedLabel(t: Translator, observedAt: number): string {
	return new Date(observedAt).toLocaleTimeString(localeOf(t), {
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
	const t = useT();
	if (snapshot.state === "hidden") return null;
	if (snapshot.state === "loading") {
		return (
			<IconTooltip label={t("shell.jbcentralQuota.loadingTooltip")}>
				<span
					data-testid="jbcentral-quota"
					data-state="loading"
					className="inline-flex shrink-0 items-center gap-4 whitespace-nowrap text-text-muted tr-text-ui"
				>
					<Loader className="size-14 animate-spin" aria-hidden="true" />
					<span>{t("shell.jbcentralQuota.loading")}</span>
				</span>
			</IconTooltip>
		);
	}
	if (snapshot.state === "unavailable") {
		return (
			<IconTooltip label={t("shell.jbcentralQuota.unavailableTooltip")}>
				<button
					type="button"
					data-testid="jbcentral-quota"
					data-state="unavailable"
					onClick={onRetry}
					className="inline-flex shrink-0 items-center gap-4 whitespace-nowrap rounded-sm text-text-muted tr-text-ui outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					<Coins className="size-14" aria-hidden="true" />
					<span>{t("shell.jbcentralQuota.unavailable")}</span>
					<span className="hidden sm:inline">{t("shell.jbcentralQuota.retrySuffix")}</span>
				</button>
			</IconTooltip>
		);
	}

	const value = formatJbcentralQuota(snapshot.remaining, snapshot.total, localeOf(t));
	const stale = snapshot.state === "stale";
	const content = (
		<>
			<Coins className="size-14 text-text-muted" aria-hidden="true" />
			<span>{value}</span>
			<span className="hidden sm:inline">{t("shell.jbcentralQuota.creditsUnit")}</span>
			{stale ? (
				<span
					data-testid="jbcentral-quota-stale-marker"
					className="size-6 rounded-full bg-feedback-warning"
					aria-hidden="true"
				/>
			) : null}
		</>
	);
	const observed = observedLabel(t, snapshot.observedAt);
	const label = stale
		? t("shell.jbcentralQuota.staleLabel", { value })
		: t("shell.jbcentralQuota.availableLabel", { value, time: observed });
	const className =
		"inline-flex shrink-0 items-center gap-4 whitespace-nowrap text-text-default tr-text-ui";

	return (
		<IconTooltip
			label={
				stale
					? t("shell.jbcentralQuota.staleTooltip", { time: observed })
					: t("shell.jbcentralQuota.availableTooltip", { time: observed })
			}
		>
			{stale ? (
				<button
					type="button"
					data-testid="jbcentral-quota"
					data-state="stale"
					aria-label={label}
					onClick={onRetry}
					className={`${className} rounded-sm outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary`}
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
