import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installConfigDir, installMetaFile, readInstallMeta } from "./paths";

test("installMetaFile is where both installers write install.json", () => {
	expect(installMetaFile("/home/u")).toBe("/home/u/.config/thinkrail/install.json");
	expect(installConfigDir("/home/u")).toBe("/home/u/.config/thinkrail");
});

test("readInstallMeta reads the installers' file and degrades to {} on anything else", () => {
	const home = mkdtempSync(join(tmpdir(), "thinkrail-paths-"));
	try {
		// Absent.
		expect(readInstallMeta(home)).toEqual({});

		mkdirSync(installConfigDir(home), { recursive: true });
		writeFileSync(
			installMetaFile(home),
			JSON.stringify({ channel: "nightly", prefix: "/opt/tr", version: "1.2.3" }),
		);
		expect(readInstallMeta(home)).toEqual({
			channel: "nightly",
			prefix: "/opt/tr",
			version: "1.2.3",
		});

		// Hand-mangled: a reader must never throw here — `update` and `uninstall` both have to run
		// against a broken install, which is exactly when the file is likely to be junk.
		writeFileSync(installMetaFile(home), "{not json");
		expect(readInstallMeta(home)).toEqual({});
		writeFileSync(installMetaFile(home), '"a string"');
		expect(readInstallMeta(home)).toEqual({});
		writeFileSync(installMetaFile(home), "null");
		expect(readInstallMeta(home)).toEqual({});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
