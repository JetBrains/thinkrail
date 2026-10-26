import { expect, test } from "bun:test";
import { desktopAppUserModelId, loadWindowsShellApi } from "./windowsTaskbarIdentity";

test("names one AppUserModelID per channel", () => {
	expect(desktopAppUserModelId("stable")).toBe("JetBrains.ThinkRail");
	expect(desktopAppUserModelId("nightly")).toBe("JetBrains.ThinkRail.Nightly");
	expect(desktopAppUserModelId("dev")).toBe("JetBrains.ThinkRail.Dev");
	expect(() => desktopAppUserModelId("beta")).toThrow('unknown release channel "beta"');
});

test.skipIf(process.platform !== "win32")("sets the process AppUserModelID", () => {
	const shell = loadWindowsShellApi();
	expect(loadWindowsShellApi()).toBe(shell);
	shell.setProcessAppUserModelId("JetBrains.ThinkRail.Test");
	expect(shell.processAppUserModelId()).toBe("JetBrains.ThinkRail.Test");
});
