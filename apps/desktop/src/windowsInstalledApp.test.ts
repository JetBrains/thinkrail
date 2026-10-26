import { expect, test } from "bun:test";
import {
	installedAppKey,
	loadWindowsRegistryApi,
	stampInstalledAppPublisher,
	type WindowsRegistryApi,
} from "./windowsInstalledApp";

function fakeRegistry(values: Record<string, string>) {
	const writes: string[] = [];
	const registry: WindowsRegistryApi = {
		readString: (subKey, name) => values[`${subKey}|${name}`] ?? null,
		writeString: (subKey, name, value) => {
			writes.push(`${subKey}|${name}=${value}`);
			values[`${subKey}|${name}`] = value;
		},
	};
	return { registry, writes };
}

test("names Electrobun's Installed-apps key for an install", () => {
	expect(
		installedAppKey({ identifier: "ai.thinkrail.app", channel: "canary", startMenuShortcut: null }),
	).toBe("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ai.thinkrail.app.canary");
});

test("adds the publisher only to a registered install that lacks it", () => {
	const key = "Uninstall\\ai.thinkrail.app.stable";
	const { registry, writes } = fakeRegistry({ [`${key}|DisplayName`]: "ThinkRail" });

	expect(stampInstalledAppPublisher(key, "JetBrains s.r.o.", registry)).toBe(true);
	expect(stampInstalledAppPublisher(key, "JetBrains s.r.o.", registry)).toBe(false);
	expect(stampInstalledAppPublisher("Uninstall\\missing", "JetBrains s.r.o.", registry)).toBe(
		false,
	);
	expect(writes).toEqual([`${key}|Publisher=JetBrains s.r.o.`]);
});

function reg(...args: string[]): string {
	const result = Bun.spawnSync(["reg.exe", ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(result.stderr.toString());
	return result.stdout.toString();
}

test.skipIf(process.platform !== "win32")("stamps the publisher on a real registry key", () => {
	const subKey = `Software\\ThinkRailTest-${process.pid}-${Date.now()}`;
	reg("add", `HKCU\\${subKey}`, "/v", "DisplayName", "/t", "REG_SZ", "/d", "ThinkRail", "/f");
	try {
		const registry = loadWindowsRegistryApi();
		expect(loadWindowsRegistryApi()).toBe(registry);
		expect(registry.readString(subKey, "Publisher")).toBeNull();
		expect(stampInstalledAppPublisher(subKey, "JetBrains s.r.o.", registry)).toBe(true);
		expect(registry.readString(subKey, "Publisher")).toBe("JetBrains s.r.o.");
		expect(reg("query", `HKCU\\${subKey}`, "/v", "Publisher")).toContain("JetBrains s.r.o.");
		expect(stampInstalledAppPublisher(`${subKey}-missing`, "JetBrains s.r.o.", registry)).toBe(
			false,
		);
	} finally {
		reg("delete", `HKCU\\${subKey}`, "/f");
	}
});
