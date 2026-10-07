export type MobileDeviceHints = {
	userAgentDataPlatform?: string | undefined;
	platform?: string | undefined;
	userAgent?: string | undefined;
	maxTouchPoints?: number | undefined;
};

export type InstallLinkShareResult = "shared" | "copied" | "cancelled" | "failed";

export type InstallLinkShareNavigator = {
	share?: (data: { title: string; text: string; url: string }) => Promise<void>;
	clipboard?: { writeText(text: string): Promise<void> };
};

const shareCampaign = { utm_source: "send_to_computer", utm_medium: "share" } as const;

export function isMobileDevice(hints: MobileDeviceHints): boolean {
	const platform = hints.userAgentDataPlatform?.trim() || hints.platform?.trim() || "";
	const combined = `${platform} ${hints.userAgent ?? ""}`.toLowerCase();
	if (/android|iphone|ipad|ipod/.test(combined)) return true;
	return (hints.maxTouchPoints ?? 0) > 1 && /mac/.test(platform.toLowerCase());
}

export function installShareUrl(href: string, anchor: string): string {
	const url = new URL(href);
	url.search = new URLSearchParams(shareCampaign).toString();
	url.hash = anchor;
	return url.toString();
}

export async function shareInstallLink(
	nav: InstallLinkShareNavigator,
	url: string,
): Promise<InstallLinkShareResult> {
	if (nav.share) {
		try {
			await nav.share({ title: "ThinkRail", text: "Install ThinkRail on my computer", url });
			return "shared";
		} catch (error) {
			if (typeof error === "object" && error !== null && "name" in error) {
				if (error.name === "AbortError") return "cancelled";
			}
		}
	}
	try {
		if (!nav.clipboard) return "failed";
		await nav.clipboard.writeText(url);
		return "copied";
	} catch {
		return "failed";
	}
}
