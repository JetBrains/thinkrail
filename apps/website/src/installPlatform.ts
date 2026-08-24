export type InstallPlatform = "macos" | "linux" | "windows";

export interface BrowserPlatformHints {
	userAgentDataPlatform?: string | undefined;
	platform?: string | undefined;
	userAgent?: string | undefined;
	maxTouchPoints?: number | undefined;
}

export function detectInstallPlatform(hints: BrowserPlatformHints): InstallPlatform | undefined {
	const platform = hints.userAgentDataPlatform?.trim() || hints.platform?.trim() || "";
	const userAgent = hints.userAgent ?? "";
	const combined = `${platform} ${userAgent}`.toLowerCase();

	if (/android|iphone|ipad|ipod|cros/.test(combined)) return undefined;
	if (hints.maxTouchPoints && hints.maxTouchPoints > 1 && /mac/.test(platform.toLowerCase())) {
		return undefined;
	}
	if (/win/.test(platform.toLowerCase()) || /windows/.test(combined)) return "windows";
	if (/mac/.test(platform.toLowerCase())) return "macos";
	if (/linux|x11/.test(platform.toLowerCase())) return "linux";
	return undefined;
}
