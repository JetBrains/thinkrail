import { RiArrowDownSLine, RiArrowRightSLine, RiRefreshLine } from "@remixicon/react";
import type {
	SubscriptionProviderId,
	SubscriptionUsage,
	SubscriptionUsageSnapshot,
	SubscriptionUsageWindow,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { getTransport, supportsSubscriptionUsage } from "@/transport";

const POLL_INTERVAL_MS = 60_000;
const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

const PROVIDER_LABELS = {
	codex: "panels.subscriptionLimits.provider.codex",
	claude: "panels.subscriptionLimits.provider.claude",
	antigravity: "panels.subscriptionLimits.provider.antigravity",
	openrouter: "panels.subscriptionLimits.provider.openrouter",
	"opencode-go": "panels.subscriptionLimits.provider.opencodeGo",
	"kimi-coding": "panels.subscriptionLimits.provider.kimi",
	deepseek: "panels.subscriptionLimits.provider.deepseek",
} as const satisfies Record<SubscriptionProviderId, MessageKey>;

/** Window lengths the panel describes in words; anything else keeps its percentage only. */
export function subscriptionWindowKey(windowSeconds: number | null): MessageKey | null {
	if (windowSeconds === null) return null;
	if (windowSeconds % DAY_SECONDS === 0) return "panels.subscriptionLimits.windowDays";
	if (windowSeconds % HOUR_SECONDS === 0) return "panels.subscriptionLimits.windowHours";
	return null;
}

export function subscriptionWindowAmount(windowSeconds: number): number {
	return windowSeconds % DAY_SECONDS === 0
		? windowSeconds / DAY_SECONDS
		: windowSeconds / HOUR_SECONDS;
}

export function formatSubscriptionUsd(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

/** Usage past this share stops being comfortable; the bar recolours rather than adding a second label. */
export function usageTone(usedPercent: number): "calm" | "warm" | "hot" {
	if (usedPercent >= 90) return "hot";
	if (usedPercent >= 70) return "warm";
	return "calm";
}

const TONE_CLASS = {
	calm: "bg-primary",
	warm: "bg-feedback-warning",
	hot: "bg-feedback-error",
} as const;

function WindowRow({ window, locale }: { window: SubscriptionUsageWindow; locale: string }) {
	const t = useT();
	const key = subscriptionWindowKey(window.windowSeconds);
	const label =
		key && window.windowSeconds !== null
			? t(key, { amount: subscriptionWindowAmount(window.windowSeconds) })
			: null;
	const reset =
		window.resetsAt === null
			? null
			: new Date(window.resetsAt).toLocaleString(locale, {
					hour: "2-digit",
					minute: "2-digit",
					...(window.resetsAt - Date.now() > DAY_SECONDS * 1_000
						? { day: "numeric", month: "short" }
						: {}),
				});
	return (
		<div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 tr-text-metadata text-text-subtle">
			<span className="min-w-0 break-words">
				{[window.model, label].filter(Boolean).join(" · ") || t("panels.subscriptionLimits.lane")}
			</span>
			{reset ? (
				<span className="shrink-0 whitespace-nowrap tabular-nums">
					{t("panels.subscriptionLimits.resetsAt", { time: reset })}
				</span>
			) : null}
		</div>
	);
}

function UsageBody({ usage }: { usage: SubscriptionUsage }) {
	const t = useT();
	const locale = localeOf(t);
	if (usage.state === "sign-in") {
		return (
			<p className="tr-text-metadata text-text-subtle">{t("panels.subscriptionLimits.signIn")}</p>
		);
	}
	if (usage.state !== "ok") return null;
	const windows = usage.windows;
	const worst = windows.reduce((max, item) => Math.max(max, item.usedPercent), 0);
	return (
		<>
			<div className="mb-4 flex h-4 overflow-hidden rounded-full bg-control-bg-hovered">
				<div
					className={cn("h-full rounded-full", TONE_CLASS[usageTone(worst)])}
					style={{ width: `${worst}%` }}
				/>
			</div>
			<div className="flex flex-col gap-2">
				{windows.map((window) => (
					<WindowRow
						key={`${window.model ?? ""}:${window.windowSeconds ?? 0}:${window.resetsAt ?? 0}`}
						window={window}
						locale={locale}
					/>
				))}
				{usage.spend ? (
					<div className="tr-text-metadata text-text-subtle tabular-nums">
						{usage.spend.limitUsd === null
							? t("panels.subscriptionLimits.spendOnly", {
									used: formatSubscriptionUsd(usage.spend.usedUsd, locale),
								})
							: t("panels.subscriptionLimits.spendOf", {
									used: formatSubscriptionUsd(usage.spend.usedUsd, locale),
									limit: formatSubscriptionUsd(usage.spend.limitUsd, locale),
								})}
					</div>
				) : null}
			</div>
		</>
	);
}

/**
 * Permanent sidebar block listing what is left on each subscription. Providers that refuse or answer
 * nothing are not listed at all; the ones that expose no limits at all fold into one group.
 */
export function SubscriptionLimits() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const connectionStatus = useAppStore((state) => state.status);
	const supported = supportsSubscriptionUsage(protocolVersion);
	const [snapshot, setSnapshot] = useState<SubscriptionUsageSnapshot | null>(null);
	const [groupsOpen, setGroupsOpen] = useState(false);
	const visibleRef = useRef(true);
	const [visible, setVisible] = useState(
		() => typeof document === "undefined" || document.visibilityState === "visible",
	);

	const refresh = useCallback(async (force: boolean) => {
		try {
			const next = await getTransport().request(
				"usage.subscriptions",
				force ? { force: true } : {},
			);
			setSnapshot(next);
		} catch {
			// A failed read keeps the previous numbers: the panel never invents a state.
		}
	}, []);

	useEffect(() => {
		const update = () => setVisible(document.visibilityState === "visible");
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);

	useEffect(() => {
		visibleRef.current = visible;
	}, [visible]);

	useEffect(() => {
		if (!supported || connectionStatus !== "connected" || !visible) return;
		void refresh(false);
		const timer = setInterval(() => {
			if (visibleRef.current) void refresh(false);
		}, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [connectionStatus, refresh, supported, visible]);

	if (!supported || connectionStatus !== "connected") return null;
	const rows = snapshot?.rows ?? [];
	const metered = rows.filter((row) => row.usage.state === "ok" || row.usage.state === "sign-in");
	const unsupported = rows.filter((row) => row.usage.state === "unsupported");
	if (metered.length === 0 && unsupported.length === 0) return null;
	const updated =
		snapshot === null
			? t("panels.subscriptionLimits.loading")
			: new Date(snapshot.observedAt).toLocaleTimeString(localeOf(t), {
					hour: "2-digit",
					minute: "2-digit",
				});

	return (
		<div data-testid="subscription-limits" className="flex flex-col gap-12">
			<header className="flex h-panel-row items-center gap-4">
				<span className="tr-text-eyebrow flex-1 text-text-muted">
					{t("panels.subscriptionLimits.title")}
				</span>
				<IconButton
					icon={RiRefreshLine}
					label={t("panels.subscriptionLimits.refresh")}
					size="s"
					variant="ghost"
					onClick={() => void refresh(true)}
				/>
			</header>
			<div className="flex flex-col gap-12">
				{metered.map((row) => (
					<div key={row.providerId} data-testid={`subscription-limits-${row.providerId}`}>
						<div className="mb-4 flex items-baseline gap-6">
							<span className="flex-1 truncate tr-text-ui text-text-default">
								{t(PROVIDER_LABELS[row.providerId])}
							</span>
							<span className="tr-text-metadata text-text-subtle tabular-nums">
								{row.usage.state === "ok" && row.usage.windows.length > 0
									? `${Math.round(Math.max(...row.usage.windows.map((w) => w.usedPercent)))}%`
									: ""}
							</span>
						</div>
						<UsageBody usage={row.usage} />
					</div>
				))}
				{unsupported.length > 0 ? (
					<div>
						<button
							type="button"
							className="flex w-full items-center gap-4 rounded-sm py-2 text-left text-text-subtle tr-text-metadata hover:text-text-muted"
							aria-expanded={groupsOpen}
							onClick={() => setGroupsOpen((open) => !open)}
						>
							{groupsOpen ? (
								<RiArrowDownSLine className="size-14 shrink-0" />
							) : (
								<RiArrowRightSLine className="size-14 shrink-0" />
							)}
							<span className="flex-1">{t("panels.subscriptionLimits.apiKeys")}</span>
							<span className="shrink-0">
								{t("panels.subscriptionLimits.noDataCount", { count: unsupported.length })}
							</span>
						</button>
						{groupsOpen ? (
							<ul className="flex flex-col gap-2 pl-24 text-text-subtle tr-text-metadata">
								{unsupported.map((row) => (
									<li key={row.providerId}>{t(PROVIDER_LABELS[row.providerId])}</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</div>
			<footer className="flex items-center justify-between tr-text-metadata text-text-subtle">
				<span>{t("panels.subscriptionLimits.updatedAt", { time: updated })}</span>
			</footer>
		</div>
	);
}
