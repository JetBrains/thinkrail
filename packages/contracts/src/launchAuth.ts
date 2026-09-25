export const LAUNCH_TOKEN_PARAM = "token";
export const LAUNCH_AUTH_PATH = "/auth";
export const LAUNCH_TOKEN_STORAGE_KEY = "thinkrail-launch-token";

export const launchPathFor = (token: string) =>
	`/?${LAUNCH_TOKEN_PARAM}=${encodeURIComponent(token)}`;

const LAUNCH_TOKEN_IN_URL = new RegExp(`([?&]${LAUNCH_TOKEN_PARAM}=)[^&#\\s"'<>)]+`, "g");

export const redactLaunchToken = (text: string) => text.replace(LAUNCH_TOKEN_IN_URL, "$1redacted");
