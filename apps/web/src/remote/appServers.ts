import {
	browserStore,
	createHostRegistry,
	createRemoteSessions,
	type KeyValueStore,
} from "@thinkrail/remote-client";
import { useSyncExternalStore } from "react";
import { getStablePreferenceAdapter } from "../clientPreferences";
import { createServers, type ServersController, type ServersSnapshot } from "./servers";

/** What this computer calls itself to a server it pairs with; renamable on the server. */
export function computerLabel(userAgent: string): string {
	if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
	if (/Windows/.test(userAgent)) return "Windows PC";
	if (/Linux/.test(userAgent)) return "Linux PC";
	return "Computer";
}

/** Servers need WebRTC and Ed25519 signing; a webview without them (some Linux builds) offers none. */
export function serversSupported(): boolean {
	return typeof RTCPeerConnection === "function" && typeof crypto?.subtle?.sign === "function";
}

/** The desktop's stable preference store when there is one (its webview origin changes between launches). */
function serverStore(): KeyValueStore {
	const stable = getStablePreferenceAdapter();
	if (!stable) return browserStore;
	return { read: (key) => stable.getItem(key), write: (key, value) => stable.setItem(key, value) };
}

let servers: ServersController | null = null;

/** The app's saved servers, connected the first time anything asks for them. */
export function appServers(): ServersController {
	if (servers) return servers;
	const store = serverStore();
	const created = createServers({
		registry: createHostRegistry(store),
		sessions: createRemoteSessions({ keyStore: store }),
		label: computerLabel(navigator.userAgent),
	});
	servers = created;
	created.start();
	window.addEventListener("online", () => created.reconnectAll());
	return created;
}

const subscribe = (listener: () => void): (() => void) => appServers().subscribe(listener);
const snapshot = (): ServersSnapshot => appServers().snapshot();

export function useServers(): ServersSnapshot {
	return useSyncExternalStore(subscribe, snapshot);
}
