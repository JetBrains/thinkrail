import { expect, test } from "bun:test";
import { WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalSettings, WindowsShellSettings } from "./TerminalSettings";

const option = (markup: string, testId: string) =>
	markup.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

test("the Windows shell picker is hidden off Windows", () => {
	const markup = renderToStaticMarkup(
		<WindowsShellSettings
			platform="darwin"
			protocolVersion={WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION}
			value="auto"
			onSelect={() => {}}
		/>,
	);

	expect(markup).toBe("");
});

test("the Windows shell picker is hidden against older hosts", () => {
	const markup = renderToStaticMarkup(
		<WindowsShellSettings
			platform="win32"
			protocolVersion={WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION - 1}
			value="auto"
			onSelect={() => {}}
		/>,
	);

	expect(markup).toBe("");
});

test("Windows shows the four shells as an expensive list choice with the configured one applied", () => {
	const markup = renderToStaticMarkup(
		<WindowsShellSettings
			platform="win32"
			protocolVersion={WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION}
			value="cmd"
			reset={{ changed: true, onReset: () => {} }}
			onSelect={() => {}}
		/>,
	);

	expect(markup).toContain("Windows shell");
	expect(markup).toContain('data-scope="device"');
	expect(markup).toContain('data-setting-id="windows-shell"');
	expect(markup).toMatch(
		/role="listbox"[^>]*data-testid="terminal-shell-control"[^>]*data-layout="list"[^>]*data-cost="expensive"/,
	);
	expect(markup).not.toContain('type="radio"');
	for (const shell of ["auto", "pwsh", "powershell"]) {
		const choice = option(markup, `terminal-shell-${shell}`);
		expect(choice).toContain('role="option"');
		expect(choice).toContain('data-active="false"');
		expect(choice).toContain('tabindex="-1"');
	}
	const cmd = option(markup, "terminal-shell-cmd");
	expect(cmd).toContain('aria-selected="true"');
	expect(cmd).toContain('tabindex="0"');
	expect(markup).toContain('data-testid="settings-reset-windows-shell"');
	expect(markup).not.toContain("Press Enter to apply");
});

test("Terminal is a titled page whose scrollback is a cheap choice", () => {
	const markup = renderToStaticMarkup(<TerminalSettings />);
	expect(markup).toMatch(/<h2[^>]*>Terminal<\/h2>/);
	expect(markup).toContain('data-setting-id="scrollback"');
	expect(markup).toMatch(/data-testid="terminal-scrollback-control"[^>]*data-cost="cheap"/);
	expect(option(markup, "terminal-replay-64")).toContain('aria-selected="true"');
	expect(markup).not.toContain("terminal-shell-control");
});
