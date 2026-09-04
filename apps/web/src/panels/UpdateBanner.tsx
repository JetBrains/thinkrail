import {
	RiCloseLine as Close,
	RiExternalLinkLine as ExternalLink,
	RiDownloadCloud2Line as UpdateIcon,
} from "@remixicon/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SettingsSection, selectUpdateBanner, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function UpdateBanner() {
	const updateStatus = useAppStore((s) => s.updateStatus);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const installing = useAppStore((s) => s.updateStatus?.phase === "installing");
	const banner = selectUpdateBanner({ updateStatus, protocolVersion });
	if (!banner) return null;

	const install = () => {
		getTransport()
			.request("update.install", {
				channel: banner.channel as "stable" | "nightly",
				version: banner.version,
			})
			.catch(() => toast.error("Couldn't install the update"));
	};

	const dismiss = () => {
		getTransport()
			.request("update.dismiss", { version: banner.version })
			.catch(() => toast.error("Couldn't dismiss the update"));
	};

	return (
		<div
			data-testid="update-banner"
			data-kind={banner.kind}
			className="flex flex-wrap items-center gap-8 border-b border-border-default bg-primary-subtle px-16 py-8"
		>
			<UpdateIcon className="size-16 shrink-0 text-primary" />
			<span className="tr-text-ui text-text-default">
				{banner.kind === "staged"
					? `ThinkRail ${banner.version} is installed — restart to finish the update.`
					: `ThinkRail ${banner.version} is available.`}
			</span>
			<div className="ml-auto flex items-center gap-8">
				{banner.kind === "available" ? (
					<>
						{banner.notesUrl ? (
							<a
								data-testid="update-banner-notes"
								href={banner.notesUrl}
								target="_blank"
								rel="noopener noreferrer"
								className={buttonVariants({ variant: "ghost", size: "sm" })}
							>
								<ExternalLink className="size-14" />
								What's new
							</a>
						) : null}
						<Button
							data-testid="update-banner-install"
							size="sm"
							disabled={installing}
							onClick={install}
						>
							{installing ? "Installing…" : "Install"}
						</Button>
						<Button
							data-testid="update-banner-dismiss"
							variant="ghost"
							size="icon"
							aria-label="Dismiss this update"
							onClick={dismiss}
						>
							<Close className="size-16" />
						</Button>
					</>
				) : (
					<Button
						data-testid="update-banner-details"
						variant="ghost"
						size="sm"
						onClick={() => useAppStore.getState().openSettings(SettingsSection.Updates)}
					>
						Details
					</Button>
				)}
			</div>
		</div>
	);
}
