export const DESKTOP_UPDATE_BASE_URL =
	"https://github.com/JetBrains/thinkrail/releases/download/desktop-updates";

const ARTIFACT_TEST_ENVIRONMENT_KEYS = [
	"THINKRAIL_DESKTOP_READY_FILE",
	"THINKRAIL_DESKTOP_CONTROL_FILE",
	"THINKRAIL_DESKTOP_USER_DATA",
	"THINKRAIL_DESKTOP_E2E_HOST",
	"THINKRAIL_DESKTOP_HIDDEN",
	"THINKRAIL_DESKTOP_NAVIGATION_PROBE_FILE",
] as const;

export interface NativeUpdateEnablement {
	isPackaged: boolean;
	channel: string;
	baseUrl: string;
	platform: NodeJS.Platform;
	arch: string;
	artifactTestSeam: boolean;
}

export function hasDesktopArtifactTestSeam(
	environment: Readonly<Record<string, string | undefined>>,
): boolean {
	return ARTIFACT_TEST_ENVIRONMENT_KEYS.some((key) => Boolean(environment[key]));
}

export function nativeUpdatesEnabled(input: NativeUpdateEnablement): boolean {
	if (!input.isPackaged || input.artifactTestSeam) return false;
	if (input.channel !== "stable" && input.channel !== "canary") return false;
	if (input.baseUrl !== DESKTOP_UPDATE_BASE_URL) return false;
	const target = `${input.platform}-${input.arch}`;
	return (
		target === "darwin-arm64" ||
		target === "linux-arm64" ||
		target === "linux-x64" ||
		target === "win32-x64"
	);
}
