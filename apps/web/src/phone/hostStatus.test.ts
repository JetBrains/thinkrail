import { expect, test } from "bun:test";
import { RemoteConnectError } from "@thinkrail/remote-client";
import { hostStatusOf, recoveryOf } from "./hostStatus";

test("a phone the computer no longer accepts pairs again; a passing failure reconnects; an old app does neither", () => {
	expect(recoveryOf({ kind: "remote", code: "unknown_device", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "identity_mismatch", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "code_expired", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "app_outdated", message: "" })).toBe("none");
	expect(recoveryOf({ kind: "remote", code: "host_offline", message: "" })).toBe("reconnect");
	expect(recoveryOf({ kind: "network" })).toBe("reconnect");
	expect(recoveryOf({ kind: "error", message: "boom" })).toBe("reconnect");
});

test("the controller's status reads as the screens show it, its error named as a failure", () => {
	expect(hostStatusOf(undefined)).toEqual({ kind: "connecting" });
	expect(hostStatusOf({ kind: "connected" })).toEqual({ kind: "connected" });
	expect(hostStatusOf({ kind: "unreachable", error: new Error("down") })).toEqual({
		kind: "unreachable",
		failure: { kind: "error", message: "down" },
	});
	expect(
		hostStatusOf({
			kind: "unreachable",
			error: new RemoteConnectError("unknown_device", "revoked"),
		}),
	).toEqual({
		kind: "unreachable",
		failure: { kind: "remote", code: "unknown_device", message: "revoked" },
	});
});
