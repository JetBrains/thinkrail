import { expect, test } from "bun:test";
import { environmentMute } from "./mute";

test("a clean environment does not mute basic reporting", () => {
	expect(environmentMute({})).toBeNull();
});

test("the additional-only environment control does not mute basics", () => {
	for (const value of ["1", "no", ""]) {
		expect(environmentMute({ THINKRAIL_NO_ANALYTICS: value })).toBeNull();
	}
});

test("CI and bun test silence both tiers", () => {
	expect(environmentMute({ CI: "true" })).toBe("ci");
	expect(environmentMute({ CI: "" })).toBeNull();
	expect(environmentMute({ NODE_ENV: "test" })).toBe("test");
	expect(environmentMute({ NODE_ENV: "production" })).toBeNull();
	expect(environmentMute({ THINKRAIL_NO_ANALYTICS: "1", CI: "1", NODE_ENV: "test" })).toBe("ci");
});
