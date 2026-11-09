import { renderChatHighlight } from "./chatHighlighter";

export interface HighlightRequest {
	id: number;
	code: string;
	lang: string;
}

export interface HighlightReply {
	id: number;
	html: string | null;
}

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
	const { id, code, lang } = event.data;
	self.postMessage({ id, html: renderChatHighlight(code, lang) } satisfies HighlightReply);
};
