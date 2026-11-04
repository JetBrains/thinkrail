import {
	codeToHtml,
	isSupportedLanguage,
	type Lang,
	LiveTokenizer,
	type ThemedToken,
} from "@pierre/highlights";
import { THINKRAIL_PIERRE_THEME } from "@/themes";
import { escapeHtml, HIGHLIGHT_PRE_END, type HighlightLines } from "./highlightHtml";

const decoder = new TextDecoder();

export type ChatHighlight = { html: string } | { update: HighlightLines } | null;

interface LiveStream {
	tokenizer: LiveTokenizer;
	code: string;
	lang: Lang;
	sent: number;
	open: string;
	idle: ReturnType<typeof setTimeout>;
}

const renderHtml = (code: string, lang: Lang) =>
	decoder
		.decode(codeToHtml(code, { lang, theme: THINKRAIL_PIERRE_THEME }))
		.replace('class="highlights"', 'tabindex="0" class="highlights"');

function renderLine(tokens: readonly ThemedToken[]) {
	return tokens
		.filter((token) => token.content.length > 0)
		.map(
			({ color, content }) =>
				`<span style="${color ? `color:${color}` : ""}">${escapeHtml(content)}</span>`,
		)
		.join("");
}

function appendAt(tokenizer: LiveTokenizer, text: string) {
	const line = tokenizer.lineCount - 1;
	const end = { line, character: tokenizer.getLineLength(line) };
	return tokenizer.applyEdits([{ range: { start: end, end }, newText: text }]);
}

export function createChatStreams({ maxLive = 8, idleMs = 30_000 } = {}) {
	const seen = new Set<string>();
	const live = new Map<string, LiveStream>();

	function drop(key: string) {
		const stream = live.get(key);
		if (!stream) return;
		clearTimeout(stream.idle);
		stream.tokenizer.dispose();
		live.delete(key);
	}

	function start(key: string, code: string, lang: Lang) {
		drop(key);
		for (const oldest of live.keys()) {
			if (live.size < maxLive) break;
			drop(oldest);
		}
		const stream: LiveStream = {
			tokenizer: new LiveTokenizer({ lang, theme: THINKRAIL_PIERRE_THEME, code }),
			code,
			lang,
			sent: 0,
			open: renderHtml("", lang).slice(0, -HIGHLIGHT_PRE_END.length),
			idle: setTimeout(() => drop(key), idleMs),
		};
		live.set(key, stream);
		return stream;
	}

	function advance(stream: LiveStream, code: string) {
		const change = appendAt(stream.tokenizer, code.slice(stream.code.length));
		stream.code = code;
		for (const { newStartLine } of change.lineChanges) {
			stream.sent = Math.min(stream.sent, newStartLine);
		}
	}

	function collect(key: string, stream: LiveStream): ChatHighlight {
		clearTimeout(stream.idle);
		stream.idle = setTimeout(() => drop(key), idleMs);
		const last = stream.tokenizer.lineCount - 1;
		const from = stream.sent;
		const lines: string[] = [];
		for (let line = from; line < last; line++) {
			lines.push(renderLine(stream.tokenizer.getLineTokens(line).tokens));
		}
		stream.sent = last;
		const tail = renderLine(stream.tokenizer.getLineTokens(last).tokens);
		return { update: { open: stream.open, from, lines, tail } };
	}

	function highlight(key: string, code: string, lang: string): ChatHighlight {
		if (!isSupportedLanguage(lang)) return null;
		try {
			if (!seen.has(key)) {
				seen.add(key);
				return { html: renderHtml(code, lang) };
			}
			const current = live.get(key);
			if (current?.lang === lang && code.startsWith(current.code)) {
				advance(current, code);
				return collect(key, current);
			}
			return collect(key, start(key, code, lang));
		} catch {
			drop(key);
			return null;
		}
	}

	function release(key: string) {
		seen.delete(key);
		drop(key);
	}

	return { highlight, release, liveCount: () => live.size };
}
