import { afterEach, expect, test } from "bun:test";
import { scanPairLink } from "./scanPairLink";

const labels = { instructions: "Point", cancel: "Cancel" };
const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

afterEach(() => {
	if (original) Object.defineProperty(navigator, "mediaDevices", original);
	else Reflect.deleteProperty(navigator, "mediaDevices");
});

test("with no camera (the iOS Simulator) the scan says so instead of opening a scanner that never answers", async () => {
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: { enumerateDevices: () => Promise.resolve([{ kind: "audioinput" }]) },
	});
	expect(await scanPairLink(labels)).toEqual({ kind: "noCamera" });
});

test("a device list that throws does not strand the scan: it goes on to the scanner and reports its outcome", async () => {
	Object.defineProperty(navigator, "mediaDevices", {
		configurable: true,
		value: {
			enumerateDevices: () => {
				throw new Error("not allowed");
			},
		},
	});
	const outcome = await scanPairLink(labels);
	expect(outcome.kind).not.toBe("noCamera");
});
