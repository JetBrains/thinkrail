import { describe, expect, test } from "bun:test";
import { parseJbcentralArgs } from "./jbcentral";

// The wiring core's tests (transforms, proxy URLs, wired-detection, install commands) live with the
// implementation in packages/shared/src/jbcentral.test.ts — this file covers only the CLI arg surface.

describe("parseJbcentralArgs", () => {
	test("defaults to wire (no remove, no help)", () => {
		expect(parseJbcentralArgs([])).toEqual({ remove: false, help: false });
	});

	test("reads --remove and -h/--help", () => {
		expect(parseJbcentralArgs(["--remove"])).toEqual({ remove: true, help: false });
		expect(parseJbcentralArgs(["-h"])).toEqual({ remove: false, help: true });
		expect(parseJbcentralArgs(["--help"])).toEqual({ remove: false, help: true });
	});

	test("rejects an unknown flag", () => {
		expect(() => parseJbcentralArgs(["--nope"])).toThrow("Unknown option: --nope");
	});
});
