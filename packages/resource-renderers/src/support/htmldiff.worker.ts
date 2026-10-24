import htmldiff from "node-htmldiff";

self.onmessage = (event: MessageEvent<{ before: string; after: string }>) => {
	const { before, after } = event.data;
	self.postMessage(htmldiff(before, after));
};
