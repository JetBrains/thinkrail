import { expect, test } from "bun:test";
import { acquireMcpSignInLock } from "./signInLock";

test("server names sharing pi's credential namespace share one sign-in lock", () => {
	const lock = acquireMcpSignInLock("issue-tracker", "settings");
	if (!("release" in lock)) throw new Error("lock already held");
	try {
		expect(acquireMcpSignInLock("issue_tracker", "chat")).toEqual({ heldBy: "settings" });
	} finally {
		lock.release();
	}
	const next = acquireMcpSignInLock("issue_tracker", "chat");
	if (!("release" in next)) throw new Error("lock was not released");
	try {
		lock.release();
		expect(acquireMcpSignInLock("issue-tracker", "settings")).toEqual({ heldBy: "chat" });
	} finally {
		next.release();
	}
});
