import { LAUNCH_TOKEN_PARAM, LAUNCH_TOKEN_STORAGE_KEY } from "@thinkrail/contracts";

let memoryToken: string | null = null;

const storage = () => (typeof localStorage === "undefined" ? null : localStorage);

const readLaunchToken = () => {
	try {
		return storage()?.getItem(LAUNCH_TOKEN_STORAGE_KEY) ?? memoryToken;
	} catch {
		return memoryToken;
	}
};

export const storeLaunchToken = (token: string) => {
	memoryToken = token.trim();
	try {
		storage()?.setItem(LAUNCH_TOKEN_STORAGE_KEY, memoryToken);
	} catch {}
};

export const captureLaunchToken = () => {
	if (typeof location === "undefined") return;
	const url = new URL(location.href);
	const token = url.searchParams.get(LAUNCH_TOKEN_PARAM);
	if (token === null) return;
	storeLaunchToken(token);
	url.searchParams.delete(LAUNCH_TOKEN_PARAM);
	history.replaceState(history.state, "", url);
};

export const withLaunchToken = (url: string) => {
	const token = readLaunchToken();
	if (!token) return url;
	const next = new URL(url);
	next.searchParams.set(LAUNCH_TOKEN_PARAM, token);
	return next.toString();
};
