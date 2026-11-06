import { expect, test } from "bun:test";
import {
	TERMINAL_SHIFT_ENTER_PROTOCOL_VERSION,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ShiftEnterSetting, WindowsShellSettings } from "./TerminalSettings";

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

test("Windows shows all four choices with the configured one active", () => {
	const markup = renderToStaticMarkup(
		<WindowsShellSettings
			platform="win32"
			protocolVersion={WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION}
			value="cmd"
			onSelect={() => {}}
		/>,
	);

	expect(markup).toContain("Windows shell");
	expect(markup).toContain('data-testid="terminal-shell-auto" data-active="false"');
	expect(markup).toContain('data-testid="terminal-shell-pwsh" data-active="false"');
	expect(markup).toContain('data-testid="terminal-shell-powershell" data-active="false"');
	expect(markup).toContain('data-testid="terminal-shell-cmd" data-active="true"');
});

test("the Shift+Enter switch is hidden against older hosts and shown otherwise", () => {
	const hidden = renderToStaticMarkup(
		<ShiftEnterSetting
			protocolVersion={TERMINAL_SHIFT_ENTER_PROTOCOL_VERSION - 1}
			checked
			onChange={() => {}}
		/>,
	);
	expect(hidden).toBe("");

	const shown = renderToStaticMarkup(
		<ShiftEnterSetting
			protocolVersion={TERMINAL_SHIFT_ENTER_PROTOCOL_VERSION}
			checked
			onChange={() => {}}
		/>,
	);
	expect(shown).toContain("terminal-shift-enter-toggle");
});
