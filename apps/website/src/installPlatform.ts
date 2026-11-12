export type InstallPlatform = "macos" | "linux" | "windows";
export type CpuArchitecture = "arm64" | "x64";

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

export function detectCpuArchitecture(hints: {
	architecture?: string | undefined;
	platform?: string | undefined;
	userAgent?: string | undefined;
}): CpuArchitecture | undefined {
	const architecture = hints.architecture?.trim().toLowerCase() ?? "";
	if (architecture === "arm" || architecture === "arm64" || architecture === "aarch64")
		return "arm64";
	if (
		architecture === "x86" ||
		architecture === "x64" ||
		architecture === "amd64" ||
		architecture === "x86_64"
	) {
		return "x64";
	}
	const combined = `${hints.platform ?? ""} ${hints.userAgent ?? ""}`.toLowerCase();
	if (/aarch64|\barm64\b|\barmv8/.test(combined)) return "arm64";
	if (/x86_64|amd64|win64|wow64/.test(combined)) return "x64";
	return undefined;
}
