import { expect, test } from "bun:test";
import {
	DEFAULT_CONFIG,
	TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyOnSelectSettings, TerminalSettings, WindowsShellSettings } from "./TerminalSettings";

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
	expect(markup).not.toContain("terminal-copy-on-select");
});

test("copy on select is hidden before its host protocol is available", () => {
	for (const protocolVersion of [null, TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION - 1]) {
		expect(
			renderToStaticMarkup(
				<CopyOnSelectSettings
					protocolVersion={protocolVersion}
					value={false}
					onSelect={() => {}}
				/>,
			),
		).toBe("");
	}
});

test("copy on select is a device-scoped switch that defaults off and resets when changed", () => {
	for (const value of [DEFAULT_CONFIG.terminalCopyOnSelect, true]) {
		const markup = renderToStaticMarkup(
			<CopyOnSelectSettings
				protocolVersion={TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION}
				value={value}
				reset={{ changed: value, onReset: () => {} }}
				onSelect={() => {}}
			/>,
		);
		expect(markup).toContain('data-scope="device"');
		expect(markup).toContain('data-setting-id="terminal-copy-on-select"');
		expect(markup).toContain('role="switch"');
		expect(markup).toContain(`aria-checked="${value}"`);
		expect(option(markup, "terminal-copy-on-select")).toContain('tabindex="0"');
		expect(markup.includes('data-testid="settings-reset-terminal-copy-on-select"')).toBe(value);
	}
});
