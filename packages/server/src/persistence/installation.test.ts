import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimAppInstalledIn } from "./installation";

test("a failed atomic marker replacement preserves the install record and a retry claims once", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	const target = join(directory, "installation.json");
	const oldContents = `${JSON.stringify({ id: "existing-install" }, null, "\t")}\n`;
	writeFileSync(target, oldContents);
	try {
		expect(() =>
			claimAppInstalledIn(directory, (temp, destination) => {
				expect(dirname(String(temp))).toBe(directory);
				expect(dirname(String(destination))).toBe(directory);
				expect(String(destination)).toBe(target);
				expect(JSON.parse(readFileSync(temp, "utf8"))).toEqual({
					id: "existing-install",
					appInstalled: true,
				});
				throw new Error("replacement failed");
			}),
		).toThrow("replacement failed");
		expect(readFileSync(target, "utf8")).toBe(oldContents);
		expect(readdirSync(directory)).toEqual(["installation.json"]);

		expect(claimAppInstalledIn(directory, renameSync)).toBe(true);
		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
			id: "existing-install",
			appInstalled: true,
		});
		expect(claimAppInstalledIn(directory, renameSync)).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
