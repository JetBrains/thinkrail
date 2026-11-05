import { expect, test } from "bun:test";
import type { RemoteAccessStatus } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShownPairing } from "../panels/usePhoneAccess";
import { PhoneAccessPanel, type PhoneAccessPanelProps } from "./PhoneAccessTopbar";

const off: RemoteAccessStatus = { enabled: false, addresses: [], devices: [] };
const on: RemoteAccessStatus = {
	enabled: true,
	addresses: [{ url: "ws://192.168.0.2:24243", route: "lan" }],
	devices: [{ id: "d1", label: "Phone", pairedAt: Date.UTC(2026, 10, 2) }],
};
const pairing: ShownPairing = {
	link: "thinkrail://pair?v=1",
	expiresAt: Date.UTC(2026, 10, 4, 12, 0),
	qrSrc: "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
};

function render(over: Partial<PhoneAccessPanelProps>): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<PhoneAccessPanel
				headingId="h"
				status={off}
				pairing={null}
				expired={false}
				pending={false}
				onToggle={() => {}}
				onShowCode={() => {}}
				onCopyLink={() => {}}
				onRevoke={() => {}}
				onOpenSettings={() => {}}
				{...over}
			/>
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
