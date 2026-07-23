import htmldiff from "node-htmldiff";

/**
 * Off-main-thread htmldiff: `node-htmldiff` is a pure string→string function whose matching is
 * super-linear on repetitive content (~7s for 800 repetitive list rows), so `RenderedDiff` posts the
 * two static-HTML sides here and renders the merged result when it arrives — the main thread never
 * blocks. One worker per pending request (spawned/terminated by `RenderedDiff`), so a message needs
 * no correlation id: terminating the worker *is* the cancellation.
 */
self.onmessage = (event: MessageEvent<{ before: string; after: string }>) => {
	const { before, after } = event.data;
	self.postMessage(htmldiff(before, after));
};
