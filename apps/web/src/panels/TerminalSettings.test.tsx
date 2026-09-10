import { expect, test } from "bun:test";
import { WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { WindowsShellSettings } from "./TerminalSettings";

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
