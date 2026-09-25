import { LAUNCH_TOKEN_PARAM, LAUNCH_TOKEN_STORAGE_KEY } from "@thinkrail/contracts";
import { E2E_LAUNCH_TOKEN } from "./paths";

export const launchStorageState = (baseURL: string) => ({
	cookies: [],
	origins: [
		{
			origin: new URL(baseURL).origin,
			localStorage: [{ name: LAUNCH_TOKEN_STORAGE_KEY, value: E2E_LAUNCH_TOKEN }],
		},
	],
});

export const withE2eLaunchToken = (url: string) => {
	const next = new URL(url);
	next.searchParams.set(LAUNCH_TOKEN_PARAM, E2E_LAUNCH_TOKEN);
	return next.toString();
};
