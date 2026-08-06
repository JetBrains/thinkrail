import { expect, test } from "bun:test";
import { environmentMute } from "./mute";

test("a clean env may send", () => {
	expect(environmentMute({})).toBeNull();
});

test("THINKRAIL_NO_ANALYTICS mutes on any non-empty value", () => {
	expect(environmentMute({ THINKRAIL_NO_ANALYTICS: "1" })).toBe("env");
	expect(environmentMute({ THINKRAIL_NO_ANALYTICS: "no" })).toBe("env");
	expect(environmentMute({ THINKRAIL_NO_ANALYTICS: "" })).toBeNull();
});

test("CI mutes — automated runs never send", () => {
	expect(environmentMute({ CI: "true" })).toBe("ci");
	expect(environmentMute({ CI: "" })).toBeNull();
});

test("bun test's NODE_ENV=test mutes, so a unit test that boots a host stays silent", () => {
	expect(environmentMute({ NODE_ENV: "test" })).toBe("test");
	expect(environmentMute({ NODE_ENV: "production" })).toBeNull();
});

test("precedence is stable: the explicit opt-out wins, then CI, then test", () => {
	expect(environmentMute({ THINKRAIL_NO_ANALYTICS: "1", CI: "true", NODE_ENV: "test" })).toBe(
		"env",
	);
	expect(environmentMute({ CI: "true", NODE_ENV: "test" })).toBe("ci");
});
