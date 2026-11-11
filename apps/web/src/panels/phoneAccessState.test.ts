import { expect, test } from "bun:test";
import type { RemoteAccessStatus } from "@thinkrail/contracts";
import {
	createLatestGate,
	initialPhoneAccess,
	newDevice,
	type PhoneAccessEvent,
	type PhoneAccessState,
	phoneAccessReducer,
	phoneHasNoRoute,
	phoneReach,
	type ShownPairing,
	shouldAutoIssue,
} from "./phoneAccessState";

const off: RemoteAccessStatus = { enabled: false, addresses: [], devices: [] };
const on: RemoteAccessStatus = {
	enabled: true,
	addresses: [{ url: "ws://192.168.0.2:24243", route: "lan" }],
	devices: [],
	relay: { kind: "builtIn", port: 24243, publicCheck: { state: "closed", ip: "80.0.0.1" } },
};
const phone = {
	id: "d1",
	label: "Mobile",
	pairedAt: 1,
	access: "write" as const,
	connected: false,
};
const onWithPhone: RemoteAccessStatus = { ...on, devices: [phone] };
const code: ShownPairing = { link: "thinkrail://pair?v=1", expiresAt: 10, qrSrc: "data:x" };

const run = (...events: PhoneAccessEvent[]): PhoneAccessState =>
	events.reduce(phoneAccessReducer, initialPhoneAccess);

test("newDevice names the device the earlier status did not list", () => {
	expect(newDevice(on, onWithPhone)).toEqual(phone);
	expect(newDevice(onWithPhone, onWithPhone)).toBeNull();
	expect(newDevice(null, on)).toBeNull();
});

test("minting a code: issuing, then the code on screen", () => {
	const minting = run({ type: "status", status: on }, { type: "issuing" });
	expect(minting.issuing).toBe(true);
	expect(minting.pairing).toBeNull();
	const shown = phoneAccessReducer(minting, { type: "issued", pairing: code, generation: 0 });
	expect(shown.issuing).toBe(false);
	expect(shown.pairing).toEqual(code);
});

test("a phone pairing from the shown code replaces the code with who paired, not an endless wait", () => {
	const paired = run(
		{ type: "status", status: on },
		{ type: "issuing", auto: true },
		{ type: "issued", pairing: code, generation: 0 },
		{ type: "polled", status: onWithPhone },
	);
	expect(paired.pairing).toBeNull();
	expect(paired.issuing).toBe(false);
	expect(paired.justPaired).toBe("Mobile");
	expect(paired.status).toEqual(onWithPhone);
	expect(shouldAutoIssue(paired)).toBe(false);
});

test("a poll with no new phone keeps the code", () => {
	const still = run(
		{ type: "status", status: on },
		{ type: "issuing" },
		{ type: "issued", pairing: code, generation: 0 },
		{ type: "polled", status: on },
	);
	expect(still.pairing).toEqual(code);
	expect(still.justPaired).toBeNull();
});

test("asking for another code clears the paired note", () => {
	const again = run(
		{ type: "status", status: on },
		{ type: "issuing" },
		{ type: "issued", pairing: code, generation: 0 },
		{ type: "polled", status: onWithPhone },
		{ type: "issuing" },
	);
	expect(again.justPaired).toBeNull();
	expect(again.issuing).toBe(true);
});

test("a failed mint stops the wait so the panel can offer Show code again", () => {
	const failed = run(
		{ type: "status", status: on },
		{ type: "issuing" },
		{ type: "issueFailed", generation: 0 },
	);
	expect(failed.issuing).toBe(false);
	expect(failed.pairing).toBeNull();
});

test("turning access off drops the code and the paired note, and a code minted meanwhile is ignored", () => {
	const shown = run(
		{ type: "status", status: on },
		{ type: "issuing" },
		{ type: "issued", pairing: code, generation: 0 },
	);
	const offNow = phoneAccessReducer(shown, { type: "status", status: off });
	expect(offNow.pairing).toBeNull();
	expect(offNow.justPaired).toBeNull();

	const late = run(
		{ type: "status", status: on },
		{ type: "issuing" },
		{ type: "status", status: off },
		{ type: "issued", pairing: code, generation: 0 },
	);
	expect(late.pairing).toBeNull();
	expect(late.issuing).toBe(false);

	// Off and on again before the old mint returns: the relay restarted, so that code is dead — never shown.
	const stale = run(
		{ type: "status", status: on },
		{ type: "issuing" },
		{ type: "status", status: off },
		{ type: "status", status: on },
		{ type: "issued", pairing: code, generation: 0 },
	);
	expect(stale.pairing).toBeNull();
	expect(stale.issuing).toBe(false);
});

test("the quick panel mints one code on its own per on-stretch, and only where a phone can reach it", () => {
	expect(shouldAutoIssue(initialPhoneAccess)).toBe(false);
	expect(shouldAutoIssue(run({ type: "status", status: off }))).toBe(false);
	expect(shouldAutoIssue(run({ type: "status", status: { ...on, addresses: [] } }))).toBe(false);
	const nostrOnly = { ...on, addresses: [], nostr: { relays: ["wss://r"], connected: 1 } };
	expect(shouldAutoIssue(run({ type: "status", status: nostrOnly }))).toBe(true);
	const fresh = run({ type: "status", status: on });
	expect(shouldAutoIssue(fresh)).toBe(true);
	const minting = phoneAccessReducer(fresh, { type: "issuing", auto: true });
	expect(shouldAutoIssue(minting)).toBe(false);
	const failed = phoneAccessReducer(minting, { type: "issueFailed", generation: 0 });
	expect(shouldAutoIssue(failed)).toBe(false);

	const backOn = run(
		{ type: "status", status: on },
		{ type: "issuing", auto: true },
		{ type: "status", status: off },
		{ type: "status", status: on },
	);
	expect(shouldAutoIssue(backOn)).toBe(true);

	const checking: RemoteAccessStatus = {
		...on,
		relay: { kind: "builtIn", port: 24243, publicCheck: { state: "checking" } },
	};
	expect(shouldAutoIssue(run({ type: "status", status: checking }))).toBe(false);
});

test("phoneReach names each route a phone has and whether it works from other networks", () => {
	expect(phoneReach(off)).toBeNull();
	expect(phoneReach(null)).toBeNull();

	const home = phoneReach(on);
	expect(home).toMatchObject({
		lan: ["192.168.0.2"],
		tailscale: [],
		routes: ["lan"],
		anywhere: false,
	});

	const tailnet = phoneReach({
		...on,
		addresses: [...on.addresses, { url: "ws://100.101.102.103:24243", route: "tailscale" }],
	});
	expect(tailnet).toMatchObject({
		tailscale: ["100.101.102.103"],
		routes: ["lan", "tailscale"],
		anywhere: true,
	});

	const vps = phoneReach({
		...on,
		addresses: [{ url: "ws://203.0.113.7:24243", route: "public" }],
		relay: { kind: "builtIn", port: 24243, publicCheck: { state: "reachable", ip: "203.0.113.7" } },
	});
	expect(vps).toMatchObject({ lan: [], routes: ["public"], anywhere: true });

	const external = phoneReach({
		...on,
		addresses: [{ url: "wss://relay.example", route: "relay" }],
		relay: { kind: "external", url: "wss://relay.example" },
	});
	expect(external).toMatchObject({
		external: "wss://relay.example",
		routes: ["relay"],
		anywhere: true,
	});
});

test("a live Nostr relay reaches phones on any network; none live leaves the route listed but down", () => {
	const nostr = { relays: ["wss://relay.one", "wss://relay.two/v1"], connected: 1 };
	expect(phoneReach({ ...on, nostr })).toMatchObject({
		nostr: { hosts: ["relay.one", "relay.two"], connected: 1 },
		routes: ["lan", "nostr"],
		anywhere: true,
	});
	expect(phoneReach({ ...on, nostr: { ...nostr, connected: 0 } })).toMatchObject({
		routes: ["lan"],
		anywhere: false,
	});

	expect(phoneHasNoRoute({ ...on, addresses: [] })).toBe(true);
	expect(phoneHasNoRoute({ ...on, addresses: [], nostr })).toBe(false);
	expect(phoneHasNoRoute(off)).toBe(false);
});

test("a status read that stays off does not count as another off", () => {
	const once = run({ type: "status", status: on }, { type: "status", status: off });
	const twice = phoneAccessReducer(once, { type: "status", status: off });
	expect(twice.generation).toBe(once.generation);
});

test("a failed first read is shown until a retry, and a status that arrives clears it", () => {
	const failed = run({ type: "loadFailed" });
	expect(failed.loadFailed).toBe(true);
	expect(phoneAccessReducer(failed, { type: "reload" }).loadFailed).toBe(false);
	expect(phoneAccessReducer(failed, { type: "status", status: on }).loadFailed).toBe(false);
	expect(run({ type: "status", status: on }, { type: "loadFailed" }).loadFailed).toBe(false);
});

test("the latest gate drops a reply to a request sent before one already taken", () => {
	const gate = createLatestGate();
	const poll = gate.ticket();
	const toggle = gate.ticket();
	expect(gate.accept(toggle)).toBe(true);
	expect(gate.accept(poll)).toBe(false);
	const next = gate.ticket();
	expect(gate.accept(next)).toBe(true);
	expect(gate.accept(next)).toBe(false);
});
