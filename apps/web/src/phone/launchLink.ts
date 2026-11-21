import { parsePairingUri } from "@thinkrail/contracts";
import type { KeyValueStore } from "@thinkrail/remote-client";
import { isPairLink } from "./scanPairLink";

const HANDLED_KEY = "thinkrail.handledPairLink";

/** Remembers a pairing link as handled, so the app's launch URL does not pair it again on a later start. */
export const markPairLinkHandled = (store: KeyValueStore, link: string): void =>
	store.write(HANDLED_KEY, link);

/**
 * The launch URL to pair, if any: not one already handled (the launch URL stays the same across mounts and
 * restarts, and its token is single-use) nor one for a computer this phone already keeps.
 */
export function launchLinkToPair(
	url: string | undefined,
	store: KeyValueStore,
	savedHostKeys: readonly string[],
): string | null {
	if (!isPairLink(url)) return null;
	const link = url.trim();
	if (store.read(HANDLED_KEY) === link) return null;
	const hostKey = parsePairingUri(link)?.hostPublicKey;
	return hostKey !== undefined && savedHostKeys.includes(hostKey) ? null : link;
}
