import { describe, expect, test } from "bun:test";
import type { JbcentralStatus } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { JetBrainsAiCard } from "./JetBrainsAiCard";

const install = {
	platform: "darwin" as const,
	shell: "bash" as const,
	command: "install central",
};

function render(status: JbcentralStatus): string {
	return renderToStaticMarkup(
		<JetBrainsAiCard status={status} install={install} onChanged={() => {}} />,
	);
}

describe("JetBrainsAiCard proxy prerequisite", () => {
	test("keeps Sign in ahead of a stopped proxy", () => {
		const markup = render({
			state: "configured",
			version: "1.7.0",
			signedOut: true,
			proxyStopped: true,
		});
		expect(markup).toContain('data-testid="jetbrains-signin"');
		expect(markup).toContain('data-testid="jetbrains-signed-out"');
		expect(markup).not.toContain('data-testid="jetbrains-start-proxy"');
		expect(markup).not.toContain('data-testid="jetbrains-disconnect"');
	});

	test("offers only Start proxy when authenticated and positively stopped", () => {
		const markup = render({
			state: "configured",
			version: "1.7.0",
			signedOut: false,
			proxyStopped: true,
		});
		expect(markup).toContain('data-testid="jetbrains-start-proxy"');
		expect(markup).toContain('data-testid="jetbrains-proxy-stopped"');
		expect(markup).not.toContain('data-testid="jetbrains-connected"');
		expect(markup).not.toContain('data-testid="jetbrains-disconnect"');
	});

	test("returns to Connected and Disconnect when the proxy is not positively stopped", () => {
		const markup = render({
			state: "configured",
			version: "1.7.0",
			signedOut: false,
			proxyStopped: false,
		});
		expect(markup).toContain('data-testid="jetbrains-connected"');
		expect(markup).toContain('data-testid="jetbrains-disconnect"');
		expect(markup).not.toContain('data-testid="jetbrains-start-proxy"');
	});
});
