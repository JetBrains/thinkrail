import { expect, test } from "bun:test";
import { startBroker } from "@thinkrail/relay";
import { discoverPublicAddress, relayAnswersAt } from "./publicAddress";

test("the STUN-mapped address is reachable only when the relay answers there", async () => {
	const mappedAddress = async () => "203.0.113.7";
	expect(
		await discoverPublicAddress(24243, { mappedAddress, answersAt: async () => true }),
	).toEqual({
		state: "reachable",
		ip: "203.0.113.7",
	});
	expect(
		await discoverPublicAddress(24243, { mappedAddress, answersAt: async () => false }),
	).toEqual({ state: "closed", ip: "203.0.113.7" });
});

test("finds nothing when STUN is unreachable, without probing", async () => {
	const probed: string[] = [];
	const found = await discoverPublicAddress(24243, {
		mappedAddress: async () => undefined,
		answersAt: async (ip) => {
			probed.push(ip);
			return true;
		},
	});
	expect(found).toEqual({ state: "offline" });
	expect(probed).toEqual([]);
});

test("the reachability probe answers for a running relay and not for a closed port", async () => {
	const relay = startBroker({ port: 0, host: "127.0.0.1" });
	try {
		expect(await relayAnswersAt("127.0.0.1", relay.port)).toBe(true);
	} finally {
		relay.stop();
	}
	expect(await relayAnswersAt("127.0.0.1", relay.port, 500)).toBe(false);
});
