import { expect, test } from "bun:test";
import type { SavedHost } from "@thinkrail/remote-client";
import { renderToStaticMarkup } from "react-dom/server";
import { ComputerRow } from "./SettingsScreen";

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
