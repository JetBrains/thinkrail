import {
	EXTENSION_API_VERSION,
	isExtensionApiCompatible,
} from "@thinkrail/extension-api/installed";

/** How an extension's manifest `api` relates to this app: loadable, or which side is out of date. */
export type ExtensionApiFit = "compatible" | "needsNewerApp" | "builtForOlderApp" | "unknown";

const API_VERSION = /^(\d+)\.(\d+)$/;

export function extensionApiFit(api: string | undefined): ExtensionApiFit {
	if (api === undefined) return "unknown";
	if (isExtensionApiCompatible(api)) return "compatible";
	const wanted = API_VERSION.exec(api);
	const own = API_VERSION.exec(EXTENSION_API_VERSION);
	if (!wanted || !own) return "unknown";
	const [wantedMajor, wantedMinor] = [Number(wanted[1]), Number(wanted[2])];
	const [ownMajor, ownMinor] = [Number(own[1]), Number(own[2])];
	return wantedMajor > ownMajor || (wantedMajor === ownMajor && wantedMinor > ownMinor)
		? "needsNewerApp"
		: "builtForOlderApp";
}

export { EXTENSION_API_VERSION };
