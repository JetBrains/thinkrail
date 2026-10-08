import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { createChatHighlighter } from "./highlighter";

export interface HighlightRequest {
	id: number;
	code: string;
	lang: string;
}

export interface HighlightReply {
	id: number;
	html: string | null;
	failed?: boolean;
}

const highlight = createChatHighlighter(() => createOnigurumaEngine(import("shiki/wasm")));

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
	const { id, code, lang } = event.data;
	void highlight(code, lang).then(
		(html) => self.postMessage({ id, html } satisfies HighlightReply),
		() => self.postMessage({ id, html: null, failed: true } satisfies HighlightReply),
	);
};
