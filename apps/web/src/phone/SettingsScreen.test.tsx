import { expect, test } from "bun:test";
import { SYSTEM_LOCALE } from "@thinkrail/locales";
import type { SavedHost } from "@thinkrail/remote-client";
import { renderToStaticMarkup } from "react-dom/server";
import { ComputerRow, SettingsScreen } from "./SettingsScreen";

const host = { hostKey: "k1", label: "Studio Mac" } as unknown as SavedHost;
const noop = (): void => {};

/** The row's first line: icon, name and status, and whatever sits at its right edge. */
const firstLine = (html: string): string => html.split("</span></div>")[1] ?? "";

test("Forget sits on the computer's own line, at its right edge, not on a row below", () => {
	const html = renderToStaticMarkup(
		<ComputerRow host={host} status={{ kind: "connected" }} onReconnect={noop} onForget={noop} />,
	);
	expect(firstLine(html)).toContain('data-testid="settings-computer-forget"');
	expect(html).not.toContain("Reconnect");
});

test("an unreachable computer keeps Forget on its line and offers Reconnect under the reason", () => {
	const html = renderToStaticMarkup(
		<ComputerRow
			host={host}
			status={{ kind: "unreachable", failure: { kind: "network" } }}
			onReconnect={noop}
			onForget={noop}
		/>,
	);
	expect(firstLine(html)).toContain('data-testid="settings-computer-forget"');
	expect(html.indexOf("settings-computer-forget")).toBeLessThan(html.indexOf("Reconnect"));
});

test("the phone's theme, contrast and language rows are the IDE Settings dialog's own choice controls", () => {
	Object.defineProperty(navigator, "languages", { value: ["en-US"], configurable: true });
	const html = renderToStaticMarkup(
		<SettingsScreen
			hosts={[host]}
			statusOf={() => ({ kind: "connected" })}
			onReconnect={noop}
			onForget={noop}
			pair={{ kind: "idle" }}
			onPair={async () => true}
			preferences={{ theme: "dark", contrast: "normal", locale: SYSTEM_LOCALE }}
			onChange={noop}
			footer={null}
		/>,
	);
	for (const testId of ["theme-mode-control", "contrast-level-control", "language-choice"])
		expect(html).toContain(`data-testid="${testId}"`);
	expect(html).toMatch(/role="option" aria-selected="true"[^>]*data-testid="theme-mode-dark"/);
	expect(html).not.toContain('type="radio"');
});
