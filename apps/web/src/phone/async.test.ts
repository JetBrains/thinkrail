import { expect, test } from "bun:test";
import { t } from "@thinkrail/locales/react";
import { reasonOf, singleFlight } from "./async";

test("a second tap while an action is in flight is dropped, and the next one after it settles runs", async () => {
	const pending: boolean[] = [];
	const flight = singleFlight((next) => pending.push(next));
	let finish = (): void => {};
	const first = flight(() => new Promise<string>((resolve) => (finish = () => resolve("done"))));
	expect(flight(async () => "twice")).toBeNull();
	expect(pending).toEqual([true]);
	finish();
	expect(await first).toBe("done");
	expect(pending).toEqual([true, false]);
	expect(await flight(async () => "again")).toBe("again");
});

test("a failed action releases the lock and still rejects to its caller", async () => {
	const flight = singleFlight();
	const failed = flight(async () => {
		throw new Error("offline");
	});
	expect(await failed?.catch((error: Error) => error.message)).toBe("offline");
	expect(await flight(async () => 1)).toBe(1);
});

test("a host refusal or a closed connection reads in the phone's words, anything else by its message", () => {
	const coded = (code: string) => Object.assign(new Error("host English"), { code });
	expect(reasonOf(coded("REMOTE_DEVICE_READ_ONLY"))).toBe(t("mobile.errors.requestReadOnly"));
	expect(reasonOf(coded("REMOTE_DEVICE_REVOKED"))).toBe(t("mobile.errors.requestRevoked"));
	expect(reasonOf(new Error("remote session closed"))).toBe(t("mobile.errors.requestClosed"));
	expect(reasonOf(coded("NOT_FOUND"))).toBe("host English");
	expect(reasonOf("plain")).toBe("plain");
	expect(reasonOf(undefined)).toBe(t("app.transport.requestFailedFallback"));
});
