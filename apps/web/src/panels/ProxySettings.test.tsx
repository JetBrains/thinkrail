import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type ManualProxy, type ProxyMode, ProxyPage } from "./ProxySettings";

const render = (mode: ProxyMode, manual: ManualProxy = { host: "", port: "" }) =>
	renderToStaticMarkup(
		<ProxyPage mode={mode} manual={manual} onSelectMode={() => {}} onManualChange={() => {}} />,
	);

test("renders all three modes with the active one highlighted", () => {
	const markup = render("system");
	expect(markup).toContain('data-testid="proxy-system" data-active="true"');
	expect(markup).toContain('data-testid="proxy-manual" data-active="false"');
	expect(markup).toContain('data-testid="proxy-none" data-active="false"');
});

test("shows the manual host and port inputs only in manual mode", () => {
	expect(render("manual")).toContain('data-testid="proxy-host-input"');
	expect(render("manual")).toContain('data-testid="proxy-port-input"');
	expect(render("system")).not.toContain('data-testid="proxy-host-input"');
	expect(render("none")).not.toContain('data-testid="proxy-port-input"');
});

test("populates the manual inputs from the stored value", () => {
	const markup = render("manual", { host: "127.0.0.1", port: "7897" });
	expect(markup).toContain('value="127.0.0.1"');
	expect(markup).toContain('value="7897"');
});
