import type { NativeOpenFileRequest } from "@thinkrail/contracts";
import { electrobunEventEmitter } from "electrobun/main/events";
import { parseThinkRailDeepLink } from "./deepLink";

const earlyDeepLinks: NativeOpenFileRequest[] = [];
let deliverDeepLink: ((request: NativeOpenFileRequest) => void) | null = null;

// This module is imported before `electrobun/main`, so the emitter exists before the
// native SDK registers its URL callback and flushes a cold-launch URL.
electrobunEventEmitter.on("open-url", (event: { data: { url: string } }) => {
	const request = parseThinkRailDeepLink(event.data.url);
	if (!request) return;
	if (deliverDeepLink) deliverDeepLink(request);
	else earlyDeepLinks.push(request);
});

export function deliverDeepLinkWhenReady(callback: (request: NativeOpenFileRequest) => void): void {
	deliverDeepLink = callback;
	for (const request of earlyDeepLinks.splice(0)) callback(request);
}
