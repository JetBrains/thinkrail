import { expect, test } from "bun:test";
import type { RemoteSessionsController, SavedHost } from "@thinkrail/remote-client";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { AddComputerScreen } from "./AddComputerScreen";
import { ComputersScreen } from "./ComputersScreen";

const hosts = [
	{ hostKey: "a", label: "Studio Mac" },
	{ hostKey: "b", label: "build-server" },
] as unknown as SavedHost[];

const noop = (): void => {};

test("the Devices tab opens each computer in place — its projects, or why it is unreachable, a read-only one marked so — with + in the header to add another", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<ComputersScreen
				hosts={hosts}
				statusOf={(hostKey) =>
					hostKey === "a"
						? { kind: "connected" }
						: { kind: "unreachable", failure: { kind: "network" } }
				}
				controller={
					{
						clientFor: () => null,
						accessFor: (hostKey: string) => (hostKey === "a" ? "read" : "write"),
					} as unknown as RemoteSessionsController
				}
				items={[]}
				pair={{ kind: "idle" }}
				onPair={() => Promise.resolve(false)}
				collapsed={new Set()}
				onToggleHost={noop}
				expanded={new Set()}
				onToggle={noop}
				onReconnect={noop}
				onForget={noop}
				onNewWorktree={noop}
				onOpen={noop}
				onAdd={noop}
				footer={null}
			/>
		</TooltipProvider>,
	);
	expect(html).toContain("Studio Mac");
	expect(html).toContain("Connected · Read only");
	expect(html).toContain("Couldn&#x27;t reach the computer");
	expect(html.indexOf('data-testid="devices-add"')).toBeLessThan(html.indexOf("Studio Mac"));
	expect(html).not.toContain("Scan QR code");
	expect(html.match(/aria-expanded="true"/g)?.length).toBe(2);
	expect(html).toContain('data-testid="host-banner"');
	expect(html.indexOf("Studio Mac")).toBeLessThan(html.indexOf("Loading"));
});

test("Add a device is its own page: how to reach the computer, then scan or paste a link", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<AddComputerScreen
				pair={{ kind: "idle" }}
				onPair={() => Promise.resolve(false)}
				backLabel="Computers"
				onBack={noop}
			/>
		</TooltipProvider>,
	);
	expect(html).toContain("thinkrail --remote");
	expect(html).toContain("Scan QR code");
	expect(html).toContain("Enter link manually");
});

test("while a link pairs, the phone shows the brand mark large and the computer it is reaching", async () => {
	const { PairingSplash } = await import("./Welcome");
	const named = renderToStaticMarkup(<PairingSplash hostName="Studio Mac" />);
	expect(named).toContain('data-testid="pairing-splash"');
	expect(named).toContain("Connecting to Studio Mac…");
	expect(renderToStaticMarkup(<PairingSplash />)).toContain("Connecting…");
});
