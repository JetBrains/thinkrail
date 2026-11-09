import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRemoteAccessEnabled, saveRemoteAccessEnabled } from "./accessSetting";

test("phone access is off until turned on, and the choice persists", () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-remote-setting-"));
	try {
		expect(loadRemoteAccessEnabled(dir)).toBe(false);
		saveRemoteAccessEnabled(true, dir);
		expect(loadRemoteAccessEnabled(dir)).toBe(true);
		saveRemoteAccessEnabled(false, dir);
		expect(loadRemoteAccessEnabled(dir)).toBe(false);
		writeFileSync(join(dir, "remote-access.json"), "not json");
		expect(loadRemoteAccessEnabled(dir)).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
