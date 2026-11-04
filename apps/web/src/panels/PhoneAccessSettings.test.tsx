import { expect, test } from "bun:test";
import type { RemoteAccessStatus } from "@thinkrail/contracts";
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
	devices: [{ id: "d1", label: "Olga's iPhone", pairedAt: Date.UTC(2026, 10, 2) }],
};
const pairing: ShownPairing = {
	link: "thinkrail://pair?v=1",
	expiresAt: Date.UTC(2026, 10, 4, 12, 0),
	qrSrc: "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
};

function render(over: Partial<PhoneAccessViewProps>): string {
	return renderToStaticMarkup(
		<PhoneAccessView
			status={off}
			pairing={null}
			expired={false}
			pending={false}
			onToggle={() => {}}
			onShowCode={() => {}}
			onCopyLink={() => {}}
			onRevoke={() => {}}
			{...over}
		/>,
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
