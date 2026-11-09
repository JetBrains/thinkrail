import { expect, test } from "bun:test";
import { deviceLabel } from "./deviceLabel";

test("a phone names its kind to the computer rather than a generic Mobile", () => {
	expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit")).toBe(
		"iPhone",
	);
	expect(deviceLabel("Mozilla/5.0 (iPad; CPU OS 26_3 like Mac OS X)")).toBe("iPad");
	expect(deviceLabel("Mozilla/5.0 (Linux; Android 16; Pixel 9) Mobile Safari")).toBe(
		"Android phone",
	);
	expect(deviceLabel("Mozilla/5.0 (Linux; Android 16; Tab S10)")).toBe("Android tablet");
	expect(deviceLabel("Mozilla/5.0 (Macintosh)")).toBe("Phone");
});
