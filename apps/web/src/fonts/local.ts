import { getStablePreferenceAdapter } from "../clientPreferences";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function sharesHostFonts(): boolean {
	return (
		getStablePreferenceAdapter() !== null ||
		(typeof location !== "undefined" && LOOPBACK_HOSTS.has(location.hostname))
	);
}
