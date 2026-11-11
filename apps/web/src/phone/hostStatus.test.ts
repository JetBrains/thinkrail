import { expect, test } from "bun:test";
import type { SavedHost } from "@thinkrail/remote-client";
import { connectSavedHost, recoveryOf } from "./hostStatus";

test("a phone the computer no longer accepts pairs again; a passing failure reconnects; an old app does neither", () => {
	expect(recoveryOf({ kind: "remote", code: "unknown_device", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "identity_mismatch", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "code_expired", message: "" })).toBe("repair");
	expect(recoveryOf({ kind: "remote", code: "app_outdated", message: "" })).toBe("none");
	expect(recoveryOf({ kind: "remote", code: "host_offline", message: "" })).toBe("reconnect");
	expect(recoveryOf({ kind: "network" })).toBe("reconnect");
	expect(recoveryOf({ kind: "error", message: "boom" })).toBe("reconnect");
});

test("Reconnect clears the shown failure first, so the row says Connecting… while the attempt runs", async () => {
	const host = { hostKey: "h" } as SavedHost;
	const marks: unknown[] = [];
	const mark = (_hostKey: string, failure: unknown): void => void marks.push(failure);
	let retried = 0;
	await connectSavedHost(
		{
			clientFor: () => ({}) as never,
			connect: () => Promise.resolve(),
			reconnectNow: () => void retried++,
		},
		host,
		mark,
	);
	expect(retried).toBe(1);
	expect(marks).toEqual([null]);

	marks.length = 0;
	await connectSavedHost(
		{
			clientFor: () => null,
			connect: () => Promise.reject(new Error("down")),
			reconnectNow: () => {},
		},
		host,
		mark,
	);
	expect(marks).toEqual([null, { kind: "error", message: "down" }]);
});
