import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { chatShikiLanguageId, createChatHighlighter } from "./highlighter";
import type { HighlightReply, HighlightRequest } from "./highlighter.worker";

export interface HighlightWorker {
	postMessage(request: HighlightRequest): void;
	terminate(): void;
}

export interface HighlightWorkerEvents {
	reply(reply: HighlightReply): void;
	fail(): void;
}

export interface HighlightClientDeps {
	spawn(events: HighlightWorkerEvents): HighlightWorker | null;
	inThread(code: string, lang: string): Promise<string | null>;
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

export function createHighlightClient({ spawn, inThread }: HighlightClientDeps) {
	const cache = new Map<string, CacheEntry>();
	const owned = new Map<string, string>();
	let cacheChars = 0;
	const slots = new Map<string, Slot>();
	const inFlight = new Map<number, InFlight>();
	let nextId = 0;
	let worker: HighlightWorker | null = null;
	let threadOnly = false;

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
		threadOnly = true;
		worker?.terminate();
		worker = null;
		for (const [id, request] of inFlight) runInThread(id, request);
	}

	function activeWorker() {
		if (threadOnly) return null;
		if (worker) return worker;
		try {
			const spawned = spawn({
				reply(message) {
					if (worker !== spawned) return;
					if (message.failed) failWorker();
					else settle(message.id, message.html);
				},
				fail() {
					if (worker === spawned) failWorker();
				},
			});
			worker = spawned;
		} catch {
			worker = null;
		}
		if (!worker) threadOnly = true;
		return worker;
	}

	function runInThread(id: number, request: InFlight) {
		inThread(request.code, request.lang)
			.catch(() => null)
			.then((html) => settle(id, html));
	}

	function dispatch(key: string, slot: Slot, call: Call) {
		const id = nextId++;
		const request: InFlight = { ...call, owner: key };
		slot.inFlight = id;
		inFlight.set(id, request);
		const target = activeWorker();
		if (target) target.postMessage({ id, code: call.code, lang: call.lang });
		else runInThread(id, request);
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
		const canonical = chatShikiLanguageId(lang);
		return canonical ? readCache(cacheKey(code, canonical)) : null;
	}

	function highlightCode(code: string, lang: string, key: string) {
		const canonical = chatShikiLanguageId(lang);
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

	return { highlightCode, cachedHighlight };
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

const inThreadHighlight = createChatHighlighter(createJavaScriptRegexEngine);

const client = createHighlightClient({
	spawn: spawnHighlighterWorker,
	inThread: (code, lang) => inThreadHighlight(code, lang).catch(() => null),
});

export function highlightCode(code: string, lang: string, key: string) {
	return client.highlightCode(code, lang, key);
}

export function cachedHighlight(code: string, lang: string) {
	return client.cachedHighlight(code, lang);
}

const PRE_END = "</code></pre>";

export interface ShownHighlight {
	seq: number;
	code: string;
	lang: string;
	html: string;
}

export function newerHighlight(shown: ShownHighlight | null, next: ShownHighlight) {
	return shown && shown.seq > next.seq ? shown : next;
}

export function staleHighlight(code: string, lang: string, latest: ShownHighlight | null) {
	if (!latest || latest.lang !== lang || !code.startsWith(latest.code)) return null;
	const tail = code.slice(latest.code.length);
	if (!tail) return latest.html;
	if (!latest.html.endsWith(PRE_END)) return null;
	const escaped = tail.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return latest.html.slice(0, -PRE_END.length) + escaped + PRE_END;
}

let highlightSeq = 0;
function nextHighlightSeq() {
	highlightSeq += 1;
	return highlightSeq;
}

function subscribeNever() {
	return () => {};
}

export function useHighlightedCode(code: string, lang: string) {
	const key = useId();
	const cached = useSyncExternalStore(
		subscribeNever,
		() => cachedHighlight(code, lang),
		() => null,
	);
	const [latest, setLatest] = useState<ShownHighlight | null>(null);

	useEffect(() => {
		const seq = nextHighlightSeq();
		void highlightCode(code, lang, key).then((html) => {
			if (html !== null) setLatest((shown) => newerHighlight(shown, { seq, code, lang, html }));
		});
	}, [code, lang, key]);

	return cached ?? staleHighlight(code, lang, latest);
}
