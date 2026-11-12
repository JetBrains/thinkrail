import { createHash } from "node:crypto";
import { ACCEPTED_IMAGE_TYPES, IMAGES_ROUTE, type RefImage } from "@thinkrail/contracts";
import { imageDimensions } from "./dimensions";

export interface ImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ImageSource {
	isServable(sessionId: string): boolean;
	find(sessionId: string, hash: string): ImageBlock | null;
}

interface Memo {
	data: string;
	mimeType: string;
	hash: string;
	width?: number;
	height?: number;
}

interface Cached {
	sessionId: string;
	data: string;
	mimeType: string;
}

export const IMAGE_CACHE_LIMIT_CHARS = 256 * 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const SESSION_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,198}[A-Za-z0-9])?$/;
const ACCEPTED = new Set(ACCEPTED_IMAGE_TYPES);
const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

const memos = new WeakMap<object, Memo>();
const cache = new Map<string, Cached>();
let cachedChars = 0;
let cacheLimit = IMAGE_CACHE_LIMIT_CHARS;
let source: ImageSource | null = null;

function isImageBlock(value: object): value is ImageBlock {
	const candidate = value as Partial<Record<keyof ImageBlock, unknown>>;
	return (
		candidate.type === "image" &&
		typeof candidate.data === "string" &&
		typeof candidate.mimeType === "string"
	);
}

function memoOf(block: ImageBlock): Memo {
	const known = memos.get(block);
	if (known && known.data === block.data && known.mimeType === block.mimeType) return known;
	const hash = createHash("sha256")
		.update(block.mimeType)
		.update("\0")
		.update(block.data)
		.digest("hex");
	const memo: Memo = {
		data: block.data,
		mimeType: block.mimeType,
		hash,
		...imageDimensions(block.data),
	};
	memos.set(block, memo);
	return memo;
}

export function imageRefHash(block: ImageBlock): string {
	return memoOf(block).hash;
}

export function findImageBlock(blocks: unknown, hash: string): ImageBlock | null {
	if (!Array.isArray(blocks)) return null;
	for (const block of blocks) {
		if (typeof block !== "object" || block === null || !isImageBlock(block)) continue;
		if (block.data.length > 0 && memoOf(block).hash === hash) return block;
	}
	return null;
}

function cacheKey(sessionId: string, hash: string): string {
	return `${sessionId}/${hash}`;
}

function touch(key: string, entry: Cached): void {
	cache.delete(key);
	cache.set(key, entry);
}

function register(sessionId: string, memo: Memo): void {
	const key = cacheKey(sessionId, memo.hash);
	const existing = cache.get(key);
	if (existing) {
		touch(key, existing);
		return;
	}
	if (memo.data.length > cacheLimit) return;
	cache.set(key, { sessionId, data: memo.data, mimeType: memo.mimeType });
	cachedChars += memo.data.length;
	for (const [oldest, entry] of cache) {
		if (cachedChars <= cacheLimit) break;
		cache.delete(oldest);
		cachedChars -= entry.data.length;
	}
}

function toRef(block: ImageBlock, sessionId: string): RefImage {
	const memo = memoOf(block);
	register(sessionId, memo);
	return {
		type: "image",
		mimeType: block.mimeType,
		ref: `${IMAGES_ROUTE}${encodeURIComponent(sessionId)}/${memo.hash}`,
		...(memo.width && memo.height ? { width: memo.width, height: memo.height } : {}),
	};
}

function isPlainObject(value: object): value is Record<string, unknown> {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function project(value: unknown, sessionId: string, done: Map<object, unknown>): unknown {
	if (typeof value !== "object" || value === null) return value;
	if (done.has(value)) return done.get(value);
	done.set(value, value);
	let result: unknown = value;
	if (Array.isArray(value)) {
		let copy: unknown[] | undefined;
		for (let index = 0; index < value.length; index++) {
			const item: unknown = value[index];
			const next = project(item, sessionId, done);
			if (next === item) continue;
			copy ??= value.slice();
			copy[index] = next;
		}
		result = copy ?? value;
	} else if (isImageBlock(value)) {
		if (value.data.length > 0) result = toRef(value, sessionId);
	} else if (isPlainObject(value)) {
		let copy: Record<string, unknown> | undefined;
		for (const key of Object.keys(value)) {
			const item = value[key];
			const next = project(item, sessionId, done);
			if (next === item) continue;
			copy ??= { ...value };
			copy[key] = next;
		}
		result = copy ?? value;
	}
	done.set(value, result);
	return result;
}

export function projectImages(value: unknown, sessionId: string): unknown {
	return project(value, sessionId, new Map());
}

export function setImageSource(next: ImageSource | null): void {
	source = next;
}

export function forgetImageSession(sessionId: string): void {
	for (const [key, entry] of cache) {
		if (entry.sessionId !== sessionId) continue;
		cache.delete(key);
		cachedChars -= entry.data.length;
	}
}

export function resetImages(options: { cacheLimitChars?: number } = {}): void {
	cache.clear();
	cachedChars = 0;
	cacheLimit = options.cacheLimitChars ?? IMAGE_CACHE_LIMIT_CHARS;
	source = null;
}

function notFound(): Response {
	return new Response("not found", { status: 404, headers: NOT_FOUND_HEADERS });
}

function lookup(sessionId: string, hash: string): Cached | null {
	const key = cacheKey(sessionId, hash);
	const cached = cache.get(key);
	if (cached) {
		touch(key, cached);
		return cached;
	}
	const found = source?.find(sessionId, hash) ?? null;
	if (!found || memoOf(found).hash !== hash) return null;
	register(sessionId, memoOf(found));
	return { sessionId, data: found.data, mimeType: found.mimeType };
}

export function serveImage(pathname: string): Response {
	const segments = pathname.slice(IMAGES_ROUTE.length).split("/");
	if (segments.length !== 2) return notFound();
	const [encodedSession = "", hash = ""] = segments;
	let sessionId: string;
	try {
		sessionId = decodeURIComponent(encodedSession);
	} catch {
		return notFound();
	}
	if (!SESSION_SEGMENT.test(sessionId) || !HASH.test(hash)) return notFound();
	if (!source?.isServable(sessionId)) return notFound();
	const image = lookup(sessionId, hash);
	const mimeType = image?.mimeType.toLowerCase();
	if (!image || mimeType === undefined || !ACCEPTED.has(mimeType)) return notFound();
	const bytes = Buffer.from(image.data, "base64");
	return new Response(bytes, {
		headers: {
			"Content-Type": mimeType,
			"Content-Length": String(bytes.byteLength),
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "sandbox; default-src 'none'",
		},
	});
}
