import { describe, expect, test } from "bun:test";
import committed from "../extension-denylist.json";
import { denylistErrors, parseDenylist } from "./extensionDenylist";

describe("the extension denylist", () => {
	test("the committed file is valid", () => {
		expect(denylistErrors(committed)).toEqual([]);
		expect(() => parseDenylist(committed)).not.toThrow();
	});

	test("reads names with an optional reason and date", () => {
		const denylist = parseDenylist({
			packages: [
				{ name: "@jane/bad", reason: "steals tokens", date: "2026-11-18" },
				{ name: "thinkrail-ext-spam" },
			],
		});
		expect([...denylist.keys()]).toEqual(["@jane/bad", "thinkrail-ext-spam"]);
		expect(denylist.get("@jane/bad")?.reason).toBe("steals tokens");
	});

	test("rejects a malformed file with every problem named", () => {
		expect(
			denylistErrors({
				packages: [
					{ name: "Not A Name" },
					{ name: "dup" },
					{ name: "dup", reason: " ", date: "2026-02-30", note: "x" },
					"thinkrail-ext-x",
				],
				extra: true,
			}),
		).toEqual([
			"unknown field extra",
			"packages[0].name is not a package name",
			"packages[2] has unknown field note",
			"packages[2].name dup is listed twice",
			"packages[2].reason must be a non-empty string",
			"packages[2].date must be a YYYY-MM-DD date",
			"packages[3] is not an object",
		]);
		expect(denylistErrors([])).toEqual(["the denylist is not an object"]);
		expect(denylistErrors({})).toEqual(["packages must be an array"]);
		expect(() => parseDenylist({ packages: [{ name: "dup" }, { name: "dup" }] })).toThrow(
			"extension-denylist.json is invalid:\n  - packages[1].name dup is listed twice",
		);
	});
});
