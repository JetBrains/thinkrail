import { expect, test } from "bun:test";
import type { RemoteAccessStatus } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	PhoneAccessView,
	type PhoneAccessViewProps,
	type ShownPairing,
} from "./PhoneAccessSettings";

const off: RemoteAccessStatus = { enabled: false, addresses: [], devices: [] };
const on: RemoteAccessStatus = {
	enabled: true,
	addresses: [{ url: "ws://192.168.0.2:24243", route: "lan" }],
	devices: [
		{
			id: "d1",
			label: "Olga's iPhone",
			pairedAt: Date.UTC(2026, 10, 2),
			access: "write",
			connected: true,
		},
	],
	relay: { kind: "builtIn", port: 24243, publicCheck: { state: "closed", ip: "80.0.0.1" } },
};
const pairing: ShownPairing = {
	link: "thinkrail://pair?v=1",
	expiresAt: Date.UTC(2026, 10, 4, 12, 0),
	qrSrc: "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
};

function render(over: Partial<PhoneAccessViewProps>): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<PhoneAccessView
				status={off}
				loadFailed={false}
				pairing={null}
				issuing={false}
				expired={false}
				pending={false}
				busyDevices={new Set()}
				onReload={() => {}}
				onToggle={() => {}}
				onShowCode={() => {}}
				onCopyLink={() => {}}
				onRevoke={() => {}}
				onRename={() => {}}
				onSetAccess={() => {}}
				{...over}
			/>
		</TooltipProvider>,
	);
}

test("off: only the switch, unchecked, and no way to make a code", () => {
	const markup = render({ status: off });
	expect(markup).toContain('data-testid="phone-access-toggle" data-active="false"');
	expect(markup).not.toContain("phone-access-show-code");
	expect(markup).toContain("No phones paired yet.");
});

test("on: a code can be shown, and paired phones list with a revoke action", () => {
	const markup = render({ status: on });
	expect(markup).toContain('data-testid="phone-access-toggle" data-active="true"');
	expect(markup).toContain("Show code");
	expect(markup).toContain("Olga&#x27;s iPhone");
	expect(markup).toContain('data-testid="phone-access-revoke-d1"');
	expect(markup).not.toContain("phone-access-no-network");
});

test("a shown code renders its QR and expiry, and offers a new one once expired", () => {
	expect(render({ status: on, pairing })).toContain(
		'data-testid="phone-access-code" data-expired="false"',
	);
	const expired = render({ status: on, pairing, expired: true });
	expect(expired).toContain("This code has expired.");
	expect(expired).toContain("New code");
	expect(expired).toContain(`src="${pairing.qrSrc}"`);
});

test("on without any reachable address warns that a phone cannot connect", () => {
	expect(render({ status: { ...on, addresses: [] } })).toContain("phone-access-no-network");
});

test("the switch is inert until the host's state arrives", () => {
	expect(render({ status: null })).toContain("disabled");
});

test("on: the network check lists each route, and a Wi‑Fi-only host points at Tailscale", () => {
	const markup = render({ status: on });
	expect(markup).toContain('data-testid="phone-route-lan" data-state="ok"');
	expect(markup).toContain("192.168.0.2");
	expect(markup).toContain('data-testid="phone-route-tailscale" data-state="off"');
	expect(markup).toContain('data-testid="phone-route-public" data-state="off"');
	expect(markup).toContain("80.0.0.1");
	expect(markup).toContain("phone-access-lan-only");
	expect(markup).toContain("Connected now");
	expect(render({ status: off })).not.toContain("phone-access-network");
});

test("a VPS with a public address shows the internet route and the firewall it needs", () => {
	const markup = render({
		status: {
			...on,
			addresses: [{ url: "ws://203.0.113.9:24243", route: "public" }],
			relay: {
				kind: "builtIn",
				port: 24243,
				publicCheck: { state: "interface", ip: "203.0.113.9" },
			},
		},
	});
	expect(markup).toContain('data-testid="phone-route-public" data-state="warn"');
	expect(markup).toContain("TCP 24243 and UDP");
	expect(markup).not.toContain("phone-access-lan-only");
});

test("while the internet check runs, the route spins and no Wi‑Fi-only notice shows yet", () => {
	const markup = render({
		status: { ...on, relay: { kind: "builtIn", port: 24243, publicCheck: { state: "checking" } } },
	});
	expect(markup).toContain('data-testid="phone-route-public" data-state="checking"');
	expect(markup).not.toContain("phone-access-lan-only");
});

test("a configured relay replaces the built-in routes", () => {
	const markup = render({
		status: {
			...on,
			addresses: [{ url: "wss://relay.example", route: "relay" }],
			relay: { kind: "external", url: "wss://relay.example" },
		},
	});
	expect(markup).toContain('data-testid="phone-route-relay"');
	expect(markup).not.toContain("phone-route-lan");
});

test("each phone shows its Read / Write access with the active one pressed", () => {
	const markup = render({
		status: {
			...on,
			devices: on.devices.map((device) => ({ ...device, access: "read" as const })),
		},
	});
	expect(markup).toContain(
		'data-testid="phone-access-device-d1" data-connected="true" data-access="read"',
	);
	expect(markup).toMatch(/data-testid="phone-access-read-d1" data-active="true"/);
	expect(markup).toMatch(/data-testid="phone-access-write-d1" data-active="false"/);
	expect(markup).toContain('data-testid="phone-access-rename-d1"');
});

test("loading: the switch waits and the devices list says loading, not empty", () => {
	const markup = render({ status: null });
	expect(markup).toContain("phone-access-loading");
	expect(markup).not.toContain("No phones paired yet.");
	expect(markup).toMatch(
		/data-testid="phone-access-toggle"[^>]*disabled=""|disabled=""[^>]*data-testid="phone-access-toggle"/,
	);
});

test("a failed first read says so with a retry instead of loading forever", () => {
	const markup = render({ status: null, loadFailed: true });
	expect(markup).toContain("phone-access-load-failed");
	expect(markup).toContain("phone-access-reload");
	expect(markup).not.toContain("phone-access-loading");
});

test("a code being made shows on the button and it cannot be pressed again", () => {
	const markup = render({ status: on, issuing: true });
	expect(markup).toMatch(/<button[^>]*data-testid="phone-access-show-code"[^>]*>/);
	const button = markup.match(/<button[^>]*data-testid="phone-access-show-code"[^>]*>/)?.[0] ?? "";
	expect(button).toContain('aria-busy="true"');
	expect(button).toContain('disabled=""');
});

test("a phone with a change in flight has its controls disabled", () => {
	const markup = render({ status: on, busyDevices: new Set(["d1"]) });
	const revoke = markup.match(/<button[^>]*data-testid="phone-access-revoke-d1"[^>]*>/)?.[0] ?? "";
	expect(revoke).toContain('disabled=""');
	const read = markup.match(/<button[^>]*data-testid="phone-access-read-d1"[^>]*>/)?.[0] ?? "";
	expect(read).toContain('disabled=""');
	const idle = render({ status: on });
	const free = idle.match(/<button[^>]*data-testid="phone-access-revoke-d1"[^>]*>/)?.[0] ?? "";
	expect(free).not.toContain('disabled=""');
});
