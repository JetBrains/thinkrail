import { type ChatHighlight, createChatStreams } from "./chatHighlighter";

export type HighlightRequest =
	| { kind: "highlight"; id: number; key: string; code: string; lang: string }
	| { kind: "release"; key: string };

export type HighlightReply = { id: number; result: ChatHighlight };

const streams = createChatStreams();

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
	const request = event.data;
	if (request.kind === "release") {
		streams.release(request.key);
		return;
	}
	const { id, key, code, lang } = request;
	self.postMessage({ id, result: streams.highlight(key, code, lang) } satisfies HighlightReply);
};
