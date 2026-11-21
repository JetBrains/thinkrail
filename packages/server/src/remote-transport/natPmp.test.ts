import { expect, test } from "bun:test";
import dgram from "node:dgram";
import {
	createNatPmpMapper,
	encodeMapRequest,
	parseAddressResponse,
	parseMapResponse,
} from "./natPmp";

function addressReply(ip: number[], result = 0): Buffer {
	const reply = Buffer.alloc(12);
	reply[1] = 128;
	reply.writeUInt16BE(result, 2);
	reply.set(ip, 8);
	return reply;
}

function mapReply(internal: number, external: number, lifetime: number, result = 0): Buffer {
	const reply = Buffer.alloc(16);
	reply[1] = 129;
	reply.writeUInt16BE(result, 2);
	reply.writeUInt16BE(internal, 8);
	reply.writeUInt16BE(external, 10);
	reply.writeUInt32BE(lifetime, 12);
	return reply;
}

test("codec reads the router's address and mapping, and refuses errors and mismatches", () => {
	expect(parseAddressResponse(addressReply([80, 114, 240, 51]))).toBe("80.114.240.51");
	expect(parseAddressResponse(addressReply([80, 114, 240, 51], 3))).toBeNull();
	expect(parseAddressResponse(addressReply([0, 0, 0, 0]))).toBeNull();
	expect(parseMapResponse(mapReply(5000, 6000, 600), 5000)).toEqual({ port: 6000, lifetime: 600 });
	expect(parseMapResponse(mapReply(5001, 6000, 600), 5000)).toBeNull();
	expect(parseMapResponse(mapReply(5000, 6000, 600, 2), 5000)).toBeNull();
	expect([...encodeMapRequest(5000, 5000, 600)]).toEqual([
		0, 1, 0, 0, 0x13, 0x88, 0x13, 0x88, 0, 0, 0x02, 0x58,
	]);
});

async function fakeRouter(options: { silent?: boolean } = {}) {
	const socket = dgram.createSocket("udp4");
	const requests: number[][] = [];
	socket.on("message", (message, from) => {
		requests.push([...message]);
		if (options.silent) return;
		const reply =
			message[1] === 0
				? addressReply([203, 0, 113, 7])
				: mapReply(
						message.readUInt16BE(4),
						message.readUInt32BE(8) === 0 ? 0 : 40_000,
						message.readUInt32BE(8),
					);
		socket.send(reply, from.port, from.address);
	});
	await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
	return { port: socket.address().port, requests, close: () => socket.close() };
}

test("maps a port through the router and deletes the mapping on release", async () => {
	const router = await fakeRouter();
	const mapper = createNatPmpMapper({
		gateway: async () => "127.0.0.1",
		port: router.port,
		timeoutMs: 50,
	});
	try {
		const lease = await mapper.open(5000);
		expect(lease).toMatchObject({ address: "203.0.113.7", port: 40_000 });
		lease?.release();
		await Bun.sleep(30);
		const ops = router.requests.map((request) => [request[1], request.at(-1)]);
		expect(ops).toEqual([
			[0, 0],
			[1, 0x58],
			[1, 0],
		]);
	} finally {
		router.close();
	}
});

test("a router that does not answer yields no lease and is not asked again for a while", async () => {
	const router = await fakeRouter({ silent: true });
	let clock = 0;
	const mapper = createNatPmpMapper({
		gateway: async () => "127.0.0.1",
		port: router.port,
		timeoutMs: 10,
		unsupportedForMs: 1_000,
		now: () => clock,
	});
	try {
		expect(await mapper.open(5000)).toBeNull();
		const asked = router.requests.length;
		expect(asked).toBeGreaterThan(0);
		expect(await mapper.open(5000)).toBeNull();
		expect(router.requests.length).toBe(asked);
		clock = 2_000;
		await mapper.open(5000);
		expect(router.requests.length).toBeGreaterThan(asked);
	} finally {
		router.close();
	}
});

test("no gateway means no lease and no traffic", async () => {
	const mapper = createNatPmpMapper({ gateway: async () => null });
	expect(await mapper.open(5000)).toBeNull();
});
