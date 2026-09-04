import type { AvailableRelease, ReleaseChannel } from "@thinkrail/contracts";

const RELEASE_REPO = "JetBrains/thinkrail";
const DEFAULT_FEED_BASE = `https://api.github.com/repos/${RELEASE_REPO}`;
const FEED_TIMEOUT_MS = 8_000;
const NIGHTLY_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d+)$/;
const STABLE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface ResolveLatestReleaseOptions {
	feedUrl?: string;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	env?: Record<string, string | undefined>;
}

interface ParsedVersion {
	core: [number, number, number];
	pre: string[];
}

function parseVersion(value: string): ParsedVersion | null {
	const raw = value.trim().replace(/^v/, "");
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
	if (!match) return null;
	const [, major, minor, patch, pre] = match;
	return {
		core: [Number(major), Number(minor), Number(patch)],
		pre: pre ? pre.split(".") : [],
	};
}

function comparePre(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 0;
	if (a.length === 0) return 1;
	if (b.length === 0) return -1;
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const left = a[i];
		const right = b[i];
		if (left === undefined) return -1;
		if (right === undefined) return 1;
		const leftNumeric = /^\d+$/.test(left);
		const rightNumeric = /^\d+$/.test(right);
		if (leftNumeric && rightNumeric) {
			if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
			continue;
		}
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
		if (left !== right) return left < right ? -1 : 1;
	}
	return 0;
}

export function compareReleaseVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;
	for (let i = 0; i < 3; i += 1) {
		const l = left.core[i] as number;
		const r = right.core[i] as number;
		if (l !== r) return l < r ? -1 : 1;
	}
	return comparePre(left.pre, right.pre);
}

export function releaseNotesUrl(version: string): string {
	const tag = `v${version.trim().replace(/^v/, "")}`;
	return `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`;
}

interface FeedRelease {
	tag_name?: unknown;
	published_at?: unknown;
	draft?: unknown;
}

function toRelease(
	entry: FeedRelease,
	channel: ReleaseChannel,
	pattern: RegExp,
): AvailableRelease | null {
	if (entry.draft === true) return null;
	const tag = typeof entry.tag_name === "string" ? entry.tag_name : "";
	if (!pattern.test(tag)) return null;
	const publishedAt = typeof entry.published_at === "string" ? entry.published_at : undefined;
	const version = tag.replace(/^v/, "");
	return {
		version,
		channel,
		notesUrl: releaseNotesUrl(version),
		...(publishedAt ? { publishedAt } : {}),
	};
}

function feedSignal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(FEED_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readFeed(
	url: string,
	options: ResolveLatestReleaseOptions,
): Promise<unknown | null> {
	const doFetch = options.fetchImpl ?? fetch;
	const response = await doFetch(url, {
		headers: { Accept: "application/vnd.github+json" },
		signal: feedSignal(options.signal),
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`release feed answered HTTP ${response.status}`);
	return await response.json();
}

export async function resolveLatestRelease(
	channel: ReleaseChannel,
	options: ResolveLatestReleaseOptions = {},
): Promise<AvailableRelease | null> {
	const env = options.env ?? process.env;
	const base = (options.feedUrl ?? env.THINKRAIL_RELEASE_FEED_URL ?? DEFAULT_FEED_BASE).replace(
		/\/$/,
		"",
	);

	if (channel === "stable") {
		const payload = await readFeed(`${base}/releases/latest`, options);
		if (!payload || typeof payload !== "object") return null;
		return toRelease(payload as FeedRelease, "stable", STABLE_TAG_RE);
	}

	const payload = await readFeed(`${base}/releases?per_page=20`, options);
	if (!Array.isArray(payload)) return null;
	for (const entry of payload) {
		if (!entry || typeof entry !== "object") continue;
		const release = toRelease(entry as FeedRelease, "nightly", NIGHTLY_TAG_RE);
		if (release) return release;
	}
	return null;
}
