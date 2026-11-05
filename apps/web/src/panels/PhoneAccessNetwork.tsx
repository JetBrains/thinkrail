import {
	RiCheckboxCircleFill,
	RiErrorWarningLine,
	RiIndeterminateCircleLine,
	RiLoader4Line,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { SettingsGroup } from "@thinkrail/ui/settings";
import { cn } from "@thinkrail/ui/utils";
import type { PhoneReach } from "./phoneAccessState";
import { SettingsNotice } from "./SettingsNotice";

type RouteTone = "ok" | "warn" | "off" | "checking";

const TONE_ICON = {
	ok: { icon: RiCheckboxCircleFill, className: "text-feedback-success" },
	warn: { icon: RiErrorWarningLine, className: "text-feedback-warning" },
	off: { icon: RiIndeterminateCircleLine, className: "text-text-subtle" },
	checking: { icon: RiLoader4Line, className: "animate-spin text-text-muted" },
} as const;

function RouteRow({
	id,
	tone,
	label,
	addresses,
	detail,
}: {
	id: string;
	tone: RouteTone;
	label: string;
	addresses: readonly string[];
	detail: string;
}) {
	const { icon: Icon, className } = TONE_ICON[tone];
	return (
		<div
			data-testid={`phone-route-${id}`}
			data-state={tone}
			className="flex items-start gap-8 border-border-muted border-b py-12"
		>
			<Icon aria-hidden className={cn("mt-2 size-14 shrink-0", className)} />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-8">
					<span className="tr-text-ui text-text-default">{label}</span>
					{addresses.map((address) => (
						<span key={address} className="tr-code-text-small text-text-muted">
							{address}
						</span>
					))}
				</div>
				<span className="tr-text-metadata text-text-muted">{detail}</span>
			</div>
		</div>
	);
}

/** Settings → Phone access's network check: which routes a phone has to this computer and what each needs. */
export function PhoneAccessNetwork({ reach }: { reach: PhoneReach }) {
	const t = useT();
	if (reach.external !== null) {
		return (
			<SettingsGroup title={t("settings.phone.network")} testId="phone-access-network">
				<RouteRow
					id="relay"
					tone="ok"
					label={t("settings.phone.route.relay")}
					addresses={[reach.external]}
					detail={t("settings.phone.route.relayDetail")}
				/>
			</SettingsGroup>
		);
	}
	const port = String(reach.port ?? "");
	const check = reach.publicCheck;
	const publicRow = ((): { tone: RouteTone; addresses: string[]; detail: string } => {
		switch (check?.state) {
			case "interface":
				return {
					tone: "warn",
					addresses: [check.ip],
					detail: t("settings.phone.route.publicInterface", { port }),
				};
			case "reachable":
				return {
					tone: "ok",
					addresses: [check.ip],
					detail: t("settings.phone.route.publicReachable"),
				};
			case "closed":
				return {
					tone: "off",
					addresses: [check.ip],
					detail: t("settings.phone.route.publicClosed", { port }),
				};
			case "offline":
				return { tone: "off", addresses: [], detail: t("settings.phone.route.publicOffline") };
			default:
				return {
					tone: "checking",
					addresses: [],
					detail: t("settings.phone.route.publicChecking"),
				};
		}
	})();

	return (
		<SettingsGroup
			title={t("settings.phone.network")}
			description={t("settings.phone.networkDescription")}
			testId="phone-access-network"
		>
			<RouteRow
				id="lan"
				tone={reach.lan.length > 0 ? "ok" : "off"}
				label={t("settings.phone.route.lan")}
				addresses={reach.lan}
				detail={
					reach.lan.length > 0
						? t("settings.phone.route.lanFound")
						: t("settings.phone.route.lanMissing")
				}
			/>
			<RouteRow
				id="tailscale"
				tone={reach.tailscale.length > 0 ? "ok" : "off"}
				label={t("settings.phone.route.tailscale")}
				addresses={reach.tailscale}
				detail={
					reach.tailscale.length > 0
						? t("settings.phone.route.tailscaleFound")
						: t("settings.phone.route.tailscaleMissing")
				}
			/>
			<RouteRow id="public" label={t("settings.phone.route.public")} {...publicRow} />
			{reach.anywhere || check?.state === "checking" ? null : (
				<div className="py-12">
					<SettingsNotice variant="info" testId="phone-access-lan-only">
						{t("settings.phone.lanOnly")}
					</SettingsNotice>
				</div>
			)}
		</SettingsGroup>
	);
}
