import { describe, expect, test } from "bun:test";
import { compareReleaseVersions, releaseNotesUrl, resolveLatestRelease } from "./release";

function feed(payload: unknown, status = 200): typeof fetch {
	return (async () =>
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

describe("compareReleaseVersions", () => {
	test("orders the numeric core", () => {
		expect(compareReleaseVersions("1.4.0", "1.5.0")).toBe(-1);
		expect(compareReleaseVersions("2.0.0", "1.9.9")).toBe(1);
		expect(compareReleaseVersions("1.4.2", "v1.4.2")).toBe(0);
	});

	test("a nightly precedes its own stable and follows the previous one", () => {
		expect(compareReleaseVersions("1.4.0-nightly.3", "1.4.0")).toBe(-1);
		expect(compareReleaseVersions("1.4.0-nightly.1", "1.3.9")).toBe(1);
	});

	test("nightly counters compare numerically, not lexically", () => {
		expect(compareReleaseVersions("1.4.0-nightly.9", "1.4.0-nightly.10")).toBe(-1);
	});

	test("an unreadable version is never newer (fails closed)", () => {
		expect(compareReleaseVersions("1.0.0", "not-a-version")).toBe(0);
		expect(compareReleaseVersions("", "1.0.0")).toBe(0);
	});

	test("the source default sorts below every release, per plain semver", () => {
		expect(compareReleaseVersions("0.0.0-dev", "1.0.0")).toBe(-1);
	});
});

test("releaseNotesUrl points at the tag page either way it is spelled", () => {
	expect(releaseNotesUrl("1.4.0")).toBe(
		"https://github.com/JetBrains/thinkrail/releases/tag/v1.4.0",
	);
	expect(releaseNotesUrl("v1.4.0-nightly.2")).toBe(
		"https://github.com/JetBrains/thinkrail/releases/tag/v1.4.0-nightly.2",
	);
});

describe("resolveLatestRelease", () => {
	test("stable reads GitHub's own latest", async () => {
		const release = await resolveLatestRelease("stable", {
			env: {},
			fetchImpl: feed({ tag_name: "v1.4.0", published_at: "2026-05-04T00:00:00Z" }),
		});
		expect(release).toEqual({
			version: "1.4.0",
			channel: "stable",
			notesUrl: "https://github.com/JetBrains/thinkrail/releases/tag/v1.4.0",
			publishedAt: "2026-05-04T00:00:00Z",
		});
	});

	test("nightly takes the first nightly tag in the list, skipping stable rows", async () => {
		const release = await resolveLatestRelease("nightly", {
			env: {},
			fetchImpl: feed([
				{ tag_name: "v1.4.0" },
				{ tag_name: "v1.4.1-nightly.2" },
				{ tag_name: "v1.4.1-nightly.1" },
			]),
		});
		expect(release?.version).toBe("1.4.1-nightly.2");
		expect(release?.channel).toBe("nightly");
	});

	test("a draft is invisible to the app exactly as it is to the installers", async () => {
		const release = await resolveLatestRelease("nightly", {
			env: {},
			fetchImpl: feed([
				{ tag_name: "v1.4.2-nightly.1", draft: true },
				{ tag_name: "v1.4.1-nightly.7" },
			]),
		});
		expect(release?.version).toBe("1.4.1-nightly.7");
	});

	test("no matching release resolves to null, not an error", async () => {
		expect(await resolveLatestRelease("nightly", { env: {}, fetchImpl: feed([]) })).toBeNull();
		expect(await resolveLatestRelease("stable", { env: {}, fetchImpl: feed({}, 404) })).toBeNull();
	});

	test("a failing feed throws so the caller can report a failed check", async () => {
		await expect(
			resolveLatestRelease("stable", { env: {}, fetchImpl: feed({}, 500) }),
		).rejects.toThrow("HTTP 500");
	});

	test("THINKRAIL_RELEASE_FEED_URL redirects the feed", async () => {
		let seen = "";
		const spy = (async (url: string) => {
			seen = url;
			return new Response(JSON.stringify({ tag_name: "v9.9.9" }), { status: 200 });
		}) as unknown as typeof fetch;
		await resolveLatestRelease("stable", {
			env: { THINKRAIL_RELEASE_FEED_URL: "http://127.0.0.1:1/feed/" },
			fetchImpl: spy,
		});
		expect(seen).toBe("http://127.0.0.1:1/feed/releases/latest");
	});
});
