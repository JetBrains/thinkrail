import { expect, test } from "bun:test";
import type { RemoteAccessStatus } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import type { PhoneAccess, ShownPairing } from "../panels/usePhoneAccess";
import { PhoneAccessPanel } from "./PhoneAccessTopbar";

const off: RemoteAccessStatus = { enabled: false, addresses: [], devices: [] };
const on: RemoteAccessStatus = {
	enabled: true,
	addresses: [{ url: "ws://192.168.0.2:24243", route: "lan" }],
	devices: [
		{ id: "d1", label: "Phone", pairedAt: Date.UTC(2026, 10, 2), access: "write", connected: true },
	],
	relay: { kind: "builtIn", port: 24243, publicCheck: { state: "closed", ip: "80.0.0.1" } },
};
const pairing: ShownPairing = {
	link: "thinkrail://pair?v=1",
	expiresAt: Date.UTC(2026, 10, 4, 12, 0),
	qrSrc: "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
};

function render(over: Partial<PhoneAccess>): string {
	const access: PhoneAccess = {
		status: off,
		loadFailed: false,
		pairing: null,
		issuing: false,
		justPaired: null,
		expired: false,
		pending: false,
		busyDevices: new Set(),
		reload: () => {},
		toggle: () => {},
		showCode: () => {},
		copyLink: () => {},
		revoke: () => {},
		rename: () => {},
		setAccess: () => {},
		...over,
	};
	return renderToStaticMarkup(
		<TooltipProvider>
			<PhoneAccessPanel headingId="h" access={access} onOpenSettings={() => {}} />
		</TooltipProvider>,
	);
}

test("off: the switch unchecked, a hint, no code and no way to make one", () => {
	const markup = render({ status: off });
	expect(markup).toContain('data-testid="phone-quick-toggle" data-active="false"');
	expect(markup).not.toContain('data-testid="phone-quick-code"');
	expect(markup).not.toContain('data-testid="phone-quick-new-code"');
	expect(markup).toContain('data-testid="phone-quick-settings"');
});

test("on: the QR with copy and new code, and each paired phone with Disconnect", () => {
	const markup = render({ status: on, pairing });
	expect(markup).toContain('data-testid="phone-quick-toggle" data-active="true"');
	expect(markup).toContain(`src="${pairing.qrSrc}"`);
	expect(markup).toContain('data-testid="phone-quick-copy-link"');
	expect(markup).toContain('data-testid="phone-quick-new-code"');
	expect(markup).toContain('data-testid="phone-quick-revoke-d1"');
});

test("on without a network address: a warning instead of a code nobody can use", () => {
	const markup = render({ status: { ...on, addresses: [] } });
	expect(markup).toContain('data-testid="phone-quick-no-network"');
	expect(markup).not.toContain('data-testid="phone-quick-code"');
});

test("after a phone pairs: says so and offers to pair another instead of waiting on a code", () => {
	const markup = render({ status: on, pairing: null, justPaired: "Phone" });
	expect(markup).toContain('data-testid="phone-quick-paired"');
	expect(markup).toContain('data-testid="phone-quick-show-code"');
	expect(markup).not.toContain("Making a pairing code");
});

test("while a code is being made: the placeholder and nothing to press", () => {
	const markup = render({ status: on, pairing: null, issuing: true });
	expect(markup).toContain("Making a pairing code");
	expect(markup).not.toContain('data-testid="phone-quick-show-code"');
	expect(markup).not.toContain('data-testid="phone-quick-paired"');
});

test("no code and none being made (a mint failed): Show code, never a stuck placeholder", () => {
	const markup = render({ status: on, pairing: null, issuing: false });
	expect(markup).toContain('data-testid="phone-quick-show-code"');
	expect(markup).not.toContain("Making a pairing code");
	expect(markup).not.toContain('data-testid="phone-quick-paired"');
});

test("the panel says which networks reach this computer and marks connected phones", () => {
	const markup = render({ status: on, pairing });
	expect(markup).toContain('data-testid="phone-quick-reach" data-anywhere="false"');
	expect(markup).toContain("Same Wi‑Fi only");
	expect(markup).toContain('data-testid="phone-quick-device-d1" data-connected="true"');

	const tailnet = render({
		status: {
			...on,
			addresses: [...on.addresses, { url: "ws://100.101.102.103:24243", route: "tailscale" }],
		},
		pairing,
	});
	expect(tailnet).toContain("Connects over Wi‑Fi · Tailscale");
});

test("before the status arrives the panel says loading, not that access is off", () => {
	const markup = render({ status: null });
	expect(markup).toContain("phone-quick-loading");
	expect(markup).not.toContain("Turn on to pair");
});

test("a failed status read offers a retry", () => {
	const markup = render({ status: null, loadFailed: true });
	expect(markup).toContain("phone-quick-load-failed");
	expect(markup).toContain("phone-quick-reload");
});

test("a new code in the making and a revoke in flight cannot be pressed again", () => {
	const markup = render({ status: on, pairing, issuing: true, busyDevices: new Set(["d1"]) });
	const code = markup.match(/<button[^>]*data-testid="phone-quick-new-code"[^>]*>/)?.[0] ?? "";
	expect(code).toContain('disabled=""');
	const revoke = markup.match(/<button[^>]*data-testid="phone-quick-revoke-d1"[^>]*>/)?.[0] ?? "";
	expect(revoke).toContain('aria-busy="true"');
});

test("an expired code dims its QR and says so instead of the time it works until", () => {
	const markup = render({ status: on, pairing, expired: true });
	expect(markup).toContain('data-testid="phone-quick-code" data-expired="true"');
	expect(markup).toContain("opacity-30");
	expect(markup).toContain("This code has expired.");
	expect(markup).not.toContain("works once, until");
});
