import type { CodeHighlighter } from "@thinkrail/chat-ui/highlight";
import { assembleHighlight, type HighlightLines } from "@thinkrail/chat-ui/highlightHtml";
import { codeLanguageId } from "./codeLanguages";
import type { HighlightReply, HighlightRequest } from "./highlighter.worker";

interface HighlightWorker {
	postMessage(request: HighlightRequest): void;
	terminate(): void;
}

export interface HighlightWorkerEvents {
	reply(reply: HighlightReply): void;
	fail(): void;
}

interface HighlightClientDeps {
	spawn(events: HighlightWorkerEvents): HighlightWorker | null;
}

interface Call {
	code: string;
	lang: string;
	resolve(html: string | null): void;
}

interface Slot {
	inFlight: number | null;
	waiting: Call | null;
}

interface InFlight extends Call {
	owner: string;
}

interface CacheEntry {
	html: string;
	chars: number;
	owner: string;
}

export const HIGHLIGHT_CACHE_MAX_ENTRIES = 256;
export const HIGHLIGHT_CACHE_MAX_CHARS = 4_000_000;

const PLAIN_LANGUAGES = new Set(["mermaid", "plain", "plaintext", "text", "txt"]);

export function chatLanguageId(value: string) {
	const name = value.trim().toLowerCase();
	if (!name || PLAIN_LANGUAGES.has(name)) return null;
	return codeLanguageId(name) ?? name;
}

export function createHighlightClient({ spawn }: HighlightClientDeps) {
	const cache = new Map<string, CacheEntry>();
	const owned = new Map<string, string>();
	let cacheChars = 0;
	const slots = new Map<string, Slot>();
	const inFlight = new Map<number, InFlight>();
	const rendered = new Map<string, string[]>();
	let nextId = 0;
	let worker: HighlightWorker | null = null;
	let workerFailed = false;

	function cacheKey(code: string, lang: string) {
		return `${lang}\0${code}`;
	}

	function dropEntry(id: string) {
		const entry = cache.get(id);
		if (!entry) return;
		cache.delete(id);
		cacheChars -= entry.chars;
		if (owned.get(entry.owner) === id) owned.delete(entry.owner);
	}

	function readCache(id: string) {
		const entry = cache.get(id);
		if (!entry) return null;
		cache.delete(id);
		cache.set(id, entry);
		return entry.html;
	}

	function writeCache(code: string, lang: string, html: string, owner: string) {
		const id = cacheKey(code, lang);
		const previous = owned.get(owner);
		if (previous !== undefined) dropEntry(previous);
		dropEntry(id);
		const entry: CacheEntry = { html, chars: code.length + html.length, owner };
		if (entry.chars > HIGHLIGHT_CACHE_MAX_CHARS / 4) return;
		cache.set(id, entry);
		cacheChars += entry.chars;
		owned.set(owner, id);
		for (const oldest of cache.keys()) {
			if (cache.size <= HIGHLIGHT_CACHE_MAX_ENTRIES && cacheChars <= HIGHLIGHT_CACHE_MAX_CHARS)
				break;
			dropEntry(oldest);
		}
	}

	function failWorker() {
		workerFailed = true;
		worker?.terminate();
		worker = null;
		for (const id of [...inFlight.keys()]) settle(id, null);
	}

	function activeWorker() {
		if (workerFailed) return null;
		if (worker) return worker;
		try {
			const spawned = spawn({
				reply(message) {
					if (worker !== spawned) return;
					settle(message.id, replyHtml(message));
				},
				fail() {
					if (worker === spawned) failWorker();
				},
			});
			worker = spawned;
		} catch {
			worker = null;
		}
		if (!worker) workerFailed = true;
		return worker;
	}

	function assemble(owner: string, { open, from, lines, tail }: HighlightLines) {
		const shown = rendered.get(owner) ?? [];
		if (from > shown.length) return null;
		shown.length = from;
		shown.push(...lines);
		rendered.set(owner, shown);
		return assembleHighlight(open, shown, tail);
	}

	function replyHtml({ id, result }: HighlightReply) {
		if (!result) return null;
		if ("html" in result) return result.html;
		const request = inFlight.get(id);
		if (!request || slots.get(request.owner)?.inFlight !== id) return null;
		return assemble(request.owner, result.update);
	}

	function dispatch(key: string, slot: Slot, call: Call) {
		const id = nextId++;
		const request: InFlight = { ...call, owner: key };
		slot.inFlight = id;
		inFlight.set(id, request);
		const target = activeWorker();
		if (target)
			target.postMessage({ kind: "highlight", id, key, code: call.code, lang: call.lang });
		else settle(id, null);
	}

	function settle(id: number, html: string | null) {
		const request = inFlight.get(id);
		if (!request) return;
		inFlight.delete(id);
		if (html !== null) writeCache(request.code, request.lang, html, request.owner);
		request.resolve(html);
		const slot = slots.get(request.owner);
		if (!slot || slot.inFlight !== id) return;
		slot.inFlight = null;
		const next = slot.waiting;
		slot.waiting = null;
		if (!next) {
			slots.delete(request.owner);
			return;
		}
		const hit = readCache(cacheKey(next.code, next.lang));
		if (hit !== null) {
			next.resolve(hit);
			slots.delete(request.owner);
			return;
		}
		dispatch(request.owner, slot, next);
	}

	function cachedHighlight(code: string, lang: string) {
		const canonical = chatLanguageId(lang);
		return canonical ? readCache(cacheKey(code, canonical)) : null;
	}

	function highlightCode(code: string, lang: string, key: string) {
		const canonical = chatLanguageId(lang);
		if (!canonical) return Promise.resolve(null);
		const slot = slots.get(key);
		const hit = readCache(cacheKey(code, canonical));
		if (hit !== null) {
			slot?.waiting?.resolve(null);
			if (slot) slot.waiting = null;
			return Promise.resolve(hit);
		}
		return new Promise<string | null>((resolve) => {
			const call: Call = { code, lang: canonical, resolve };
			if (slot) {
				slot.waiting?.resolve(null);
				slot.waiting = call;
				return;
			}
			const fresh: Slot = { inFlight: null, waiting: null };
			slots.set(key, fresh);
			dispatch(key, fresh, call);
		});
	}

	function release(key: string) {
		rendered.delete(key);
		slots.get(key)?.waiting?.resolve(null);
		slots.delete(key);
		worker?.postMessage({ kind: "release", key });
	}

	return { highlightCode, cachedHighlight, release };
}

function spawnHighlighterWorker(events: HighlightWorkerEvents) {
	if (typeof Worker === "undefined") return null;
	const worker = new Worker(new URL("./highlighter.worker.ts", import.meta.url), {
		type: "module",
	});
	worker.addEventListener("message", (event: MessageEvent<HighlightReply>) =>
		events.reply(event.data),
	);
	worker.addEventListener("error", () => events.fail());
	worker.addEventListener("messageerror", () => events.fail());
	return worker;
}

const client = createHighlightClient({ spawn: spawnHighlighterWorker });

export function highlightCode(code: string, lang: string, key: string) {
	return client.highlightCode(code, lang, key);
}

export function cachedHighlight(code: string, lang: string) {
	return client.cachedHighlight(code, lang);
}

/** The worker-backed highlighter the chat renderers use through `@thinkrail/chat-ui/highlight`. */
export const webCodeHighlighter: CodeHighlighter = {
	cached: cachedHighlight,
	highlight: highlightCode,
	release: (key) => client.release(key),
};
