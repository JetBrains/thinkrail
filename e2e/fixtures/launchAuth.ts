import { LAUNCH_TOKEN_PARAM } from "@thinkrail/contracts";
import { E2E_LAUNCH_TOKEN } from "./paths";

export const E2E_LAUNCH_TOKEN_STORAGE_KEY = "thinkrail-launch-token";

export const launchStorageState = (baseURL: string) => ({
	cookies: [],
	origins: [
		{
			origin: new URL(baseURL).origin,
			localStorage: [{ name: E2E_LAUNCH_TOKEN_STORAGE_KEY, value: E2E_LAUNCH_TOKEN }],
		},
	],
});

export const withE2eLaunchToken = (url: string) => {
	const next = new URL(url);
	next.searchParams.set(LAUNCH_TOKEN_PARAM, E2E_LAUNCH_TOKEN);
	return next.toString();
};
