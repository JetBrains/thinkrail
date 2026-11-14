import { RiFileCopyLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import type { ShownPairing } from "./phoneAccessState";

function clockTime(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export interface PhonePairingCodeProps {
	pairing: ShownPairing;
	expired: boolean;
	onCopyLink: (link: string) => void;
	/** `row`: Settings' QR beside the scan hint; `stack`: the quick panel's centred QR with `actions` under it. */
	layout: "row" | "stack";
	/** Shown before Copy link in the stacked layout (the quick panel's New code). */
	actions?: ReactNode;
}

/** One shown pairing code: its QR, until when it works (or that it expired), and Copy link. */
export function PhonePairingCode({
	pairing,
	expired,
	onCopyLink,
	layout,
	actions,
}: PhonePairingCodeProps) {
	const t = useT();
	const time = clockTime(pairing.expiresAt);
	const qr = (
		<img
			src={pairing.qrSrc}
			alt={t("settings.phone.qrAlt")}
			className={cn(
				"size-192 rounded-sm",
				layout === "row" && "shrink-0",
				layout === "stack" && expired && "opacity-30",
			)}
		/>
	);

	if (layout === "stack") {
		return (
			<>
				{qr}
				<p className="m-0 text-center tr-text-metadata text-text-muted">
					{expired ? t("settings.phone.expired") : t("shell.phone.scanUntil", { time })}
				</p>
				<div className="flex items-center gap-8">
					{actions}
					<IconButton
						variant="ghost"
						size="m"
						icon={RiFileCopyLine}
						label={t("settings.phone.copyLink")}
						tooltip={t("settings.phone.copyLink")}
						data-testid="phone-quick-copy-link"
						onClick={() => onCopyLink(pairing.link)}
					/>
				</div>
			</>
		);
	}

	return (
		<div
			data-testid="phone-access-code"
			data-expired={expired}
			className="flex flex-wrap items-center gap-16 border-border-muted border-b py-12"
		>
			{qr}
			<div className="flex min-w-160 flex-1 flex-col gap-8">
				<p className="tr-text-ui text-text-default">{t("settings.phone.scanHint")}</p>
				<p className="tr-text-metadata text-text-muted">
					{expired ? t("settings.phone.expired") : t("settings.phone.expiresAt", { time })}
				</p>
				<div className="flex">
					<Button
						variant="ghost"
						size="m"
						iconLeft={RiFileCopyLine}
						data-testid="phone-access-copy-link"
						onClick={() => onCopyLink(pairing.link)}
					>
						{t("settings.phone.copyLink")}
					</Button>
				</div>
			</div>
		</div>
	);
}
