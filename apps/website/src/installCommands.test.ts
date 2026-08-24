import { describe, expect, it } from "bun:test";
import { installCommands, windowsShellLabels } from "./installCommands";

const INSTALL_PS1_URL = "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1";

describe("Windows install commands", () => {
	it("runs the installer directly in PowerShell", () => {
		expect(installCommands.windows.powershell).toBe(`irm ${INSTALL_PS1_URL} | iex`);
	});

	it("launches PowerShell from Command Prompt", () => {
		expect(installCommands.windows.cmd).toBe(`powershell -c "irm ${INSTALL_PS1_URL} | iex"`);
	});

	it("uses the approved Command Prompt label", () => {
		expect(windowsShellLabels.cmd).toBe("Command Prompt (cmd)");
	});
});
