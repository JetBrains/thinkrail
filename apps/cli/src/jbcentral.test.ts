import { describe, expect, test } from "bun:test";
import { parseJbcentralArgs } from "./jbcentral";

// The jbcentral *protocol* (URL/override transforms, the proxy probe, install hint) is unit-tested in
// `@thinkrail/shared/jbcentral`; the CLI owns only arg parsing.
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
