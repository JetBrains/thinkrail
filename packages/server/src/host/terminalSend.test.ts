import { describe, expect, test } from "bun:test";
import { drainedClientKeys, terminalDeliveryForSendStatus } from "./terminalSend";

describe("Bun terminal send status", () => {
	test("positive bytes mean delivered and writable", () => {
		expect(terminalDeliveryForSendStatus(128)).toBe("delivered");
	});

	test("-1 means accepted with backpressure, not rejected", () => {
		expect(terminalDeliveryForSendStatus(-1)).toBe("backpressured");
	});

	test("0 means dropped and therefore unavailable", () => {
		expect(terminalDeliveryForSendStatus(0)).toBe("unavailable");
	});
});

describe("drainedClientKeys", () => {
	const buffered = new Map([
		["empty", 0],
		["busy", 4096],
	]);
	const bufferedAmount = (clientKey: string): number | undefined => buffered.get(clientKey);

	test("an empty socket buffer is the drain the OS never delivered", () => {
		expect(drainedClientKeys(["empty"], bufferedAmount)).toEqual(["empty"]);
	});

	test("real backpressure stays latched", () => {
		expect(drainedClientKeys(["busy"], bufferedAmount)).toEqual([]);
	});

	test("a client whose socket is gone is left to open/close to clear", () => {
		expect(drainedClientKeys(["empty", "busy", "closed"], bufferedAmount)).toEqual(["empty"]);
	});
});
