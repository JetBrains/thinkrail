import { expect, test } from "bun:test";
import { recoveryOf } from "./hostStatus";

test("a phone the computer no longer accepts pairs again; a passing failure reconnects; an old app does neither", () => {
	expect(recoveryOf({ kind: "remote", code: "unknown_device", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "identity_mismatch", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "code_expired", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "app_outdated", message: "" })).toBe("none");
	expect(recoveryOf({ kind: "remote", code: "host_offline", message: "" })).toBe("reconnect");
	expect(recoveryOf({ kind: "network" })).toBe("reconnect");
	expect(recoveryOf({ kind: "error", message: "boom" })).toBe("reconnect");
});
