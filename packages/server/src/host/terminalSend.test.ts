import { describe, expect, test } from "bun:test";
import { terminalDeliveryForSendStatus } from "./terminalSend";

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
