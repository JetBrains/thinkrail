import { expect, test } from "bun:test";
import { brokerFailure, hostRejection } from "./connectError";

test("the relay's error reasons map to what the app can say", () => {
	expect(brokerFailure("no host available").code).toBe("host_offline");
	expect(brokerFailure("host busy").code).toBe("host_busy");
	const other = brokerFailure("too many connections");
	expect(other.code).toBe("failed");
	expect(other.message).toBe("too many connections");
});

test("a coded host rejection maps by its code", () => {
	expect(hostRejection("whatever", "invalid_code").code).toBe("code_expired");
	expect(hostRejection("whatever", "unknown_device").code).toBe("unknown_device");
	expect(hostRejection("whatever", "outdated_app").code).toBe("app_outdated");
	expect(hostRejection("pairing proof rejected", "denied").code).toBe("rejected");
});

test("a host too old to send a code is read by its reason", () => {
	expect(hostRejection("invalid or expired pairing code", undefined).code).toBe("code_expired");
	expect(hostRejection("unknown device; pair again with a fresh link", undefined).code).toBe(
		"unknown_device",
	);
	expect(hostRejection("expected proof", undefined).code).toBe("rejected");
});
