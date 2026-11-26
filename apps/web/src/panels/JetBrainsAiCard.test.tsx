import { describe, expect, test } from "bun:test";
import type { JbcentralStatus } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	JetBrainsAiCard,
	JetBrainsAiSettings,
	type JetBrainsQuotaSettings,
} from "./JetBrainsAiCard";

const install = {
	platform: "darwin" as const,
	shell: "bash" as const,
	command: "install central",
};

function render(status: JbcentralStatus): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<JetBrainsAiCard status={status} install={install} onChanged={() => {}} />
		</TooltipProvider>,
	);
}

const QUOTA: JetBrainsQuotaSettings = {
	enabled: true,
	refreshSeconds: 30,
	enabledReset: { changed: false, onReset: () => {} },
	intervalReset: { changed: false, onReset: () => {} },
	onEnabledChange: () => {},
	onRefreshSecondsChange: () => Promise.resolve(true),
};

const STATES: JbcentralStatus[] = [
	{ state: "absent" },
	{ state: "supported", version: "1.7.0", signedOut: false },
	{ state: "configured", version: "1.7.0", signedOut: false, proxyStopped: false },
	{ state: "configured", version: "1.7.0", signedOut: true, proxyStopped: true },
	{ state: "outdated", version: "0.9.2" },
	{ state: "probe-failed", reason: "timed-out" },
	{ state: "load-failed", configured: true, reason: "candidate-failed" },
];

function settings(status: JbcentralStatus, quota: JetBrainsQuotaSettings | null = QUOTA): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<JetBrainsAiSettings status={status} install={install} onChanged={() => {}} quota={quota} />
		</TooltipProvider>,
	);
}

function tag(html: string, testId: string): string {
	return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

describe("JetBrains AI in Settings", () => {
	test("the quota rows sit in the JetBrains AI group whatever state Central is in", () => {
		for (const status of STATES) {
			const html = settings(status);
			expect(html).toContain('data-testid="jetbrains-ai-card"');
			expect(html).toContain(`data-state="${status.state}"`);
			expect(html).toContain('data-setting-row="jetbrains-central"');
			expect(html).toContain('data-setting-id="jetbrains-quota"');
			expect(html).toContain('data-setting-id="jetbrains-quota-interval"');
			expect(html.match(/data-testid="jetbrains-recheck"/g)?.length ?? 0).toBeLessThan(2);
		}
	});

	test("the quota switch and a bounded whole-second number field, with their resets", () => {
		const html = settings({ state: "supported", version: "1.7.0", signedOut: false });
		expect(tag(html, "jbcentral-quota-toggle")).toContain('aria-checked="true"');
		expect(tag(html, "jbcentral-quota-toggle")).toContain('tabindex="0"');
		const interval = tag(html, "jbcentral-quota-interval");
		expect(interval).toContain('type="text"');
		expect(interval).toContain('inputMode="numeric"');
		expect(interval).toContain('value="30"');
		expect(interval).toContain("data-setting-clean");
		expect(interval).toContain('aria-invalid="false"');
		expect(html).toContain("How often the quota is checked, 1–3600 seconds.");
		expect(html).not.toContain("data-setting-reset");

		const changed = settings(
			{ state: "supported", version: "1.7.0", signedOut: false },
			{
				...QUOTA,
				enabledReset: { changed: true, onReset: () => {} },
				intervalReset: { changed: true, onReset: () => {} },
			},
		);
		expect(changed).toContain('data-testid="settings-reset-jetbrains-quota"');
		expect(changed).toContain('data-testid="settings-reset-jetbrains-quota-interval"');
	});

	test("turning display off disables but retains the interval", () => {
		const html = settings(
			{ state: "supported", version: "1.7.0", signedOut: false },
			{ ...QUOTA, enabled: false, refreshSeconds: 17 },
		);
		expect(tag(html, "jbcentral-quota-toggle")).toContain('aria-checked="false"');
		const interval = tag(html, "jbcentral-quota-interval");
		expect(interval).toContain('value="17"');
		expect(interval).toContain('disabled=""');
	});

	test("the Central card is a walk row and its actions its buttons; Recheck joins it in the header when Central is absent", () => {
		const connected = settings({
			state: "configured",
			version: "1.7.0",
			signedOut: false,
			proxyStopped: false,
		});
		expect(tag(connected, "jetbrains-ai-card")).toContain('data-setting-row="jetbrains-central"');
		expect(tag(connected, "jetbrains-ai-card")).toContain('tabindex="-1"');
		expect(tag(connected, "jetbrains-disconnect")).toContain('tabindex="0"');
		const absent = settings({ state: "absent" });
		expect(absent.match(/data-testid="jetbrains-recheck"/g)).toHaveLength(1);
		expect(tag(absent, "jetbrains-recheck")).toContain('tabindex="0"');
		expect(tag(absent, "jetbrains-copy-cmd")).toContain('tabindex="0"');
		expect(absent).toContain('data-testid="jetbrains-needs-install"');
	});

	test("an older host gets Central without the quota rows, and the dialog card has none", () => {
		expect(settings({ state: "absent" }, null)).not.toContain("jbcentral-quota");
		expect(render({ state: "supported", version: "1.7.0", signedOut: false })).not.toContain(
			"jbcentral-quota",
		);
	});
});

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
