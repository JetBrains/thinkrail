import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { fetchStarCount, formatStarCount } from "./githubStars";

describe("formatStarCount", () => {
	test.each([
		[0, "0"],
		[999, "999"],
		[1000, "1.0k"],
		[1234, "1.2k"],
		[12_345, "12.3k"],
	])("formats %d as %s", (stars, formatted) => {
		expect(formatStarCount(stars)).toBe(formatted);
	});
});

describe("fetchStarCount", () => {
	const fetchSpy = spyOn(globalThis, "fetch");
	afterAll(() => fetchSpy.mockRestore());

	test("formats the repository's stargazer count", async () => {
		fetchSpy.mockResolvedValue(Response.json({ stargazers_count: 2345 }));
		expect(await fetchStarCount()).toBe("2.3k");
		expect(fetchSpy).toHaveBeenCalledWith("https://api.github.com/repos/JetBrains/thinkrail");
	});

	test.each([
		["a failed response", () => fetchSpy.mockResolvedValue(new Response(null, { status: 403 }))],
		["a missing count", () => fetchSpy.mockResolvedValue(Response.json({}))],
		["a network error", () => fetchSpy.mockRejectedValue(new TypeError("offline"))],
	])("yields nothing for %s", async (_case, arrange) => {
		arrange();
		expect(await fetchStarCount()).toBeUndefined();
	});
});
