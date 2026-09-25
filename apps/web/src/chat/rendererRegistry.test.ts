import { expect, test } from "bun:test";
import {
	getMessageRenderer,
	registerMessageRenderer,
	subscribeRendererRegistry,
} from "./rendererRegistry";

test("message renderer registrations bump the snapshot and restore on dispose", () => {
	const seen: number[] = [];
	const stop = subscribeRendererRegistry(() => seen.push(seen.length));
	const first = () => null;
	const dispose = registerMessageRenderer("drift", first);
	expect(seen).toHaveLength(1);
	dispose();
	expect(seen).toHaveLength(2);
	stop();
});

test("disposing registrations out of order keeps the newest live renderer on top", () => {
	const a = () => null;
	const b = () => null;
	const c = () => null;
	const disposeA = registerMessageRenderer("stack", a);
	const disposeB = registerMessageRenderer("stack", b);
	disposeA();
	disposeA();
	expect(getMessageRenderer("stack")).toBe(b);
	const disposeC = registerMessageRenderer("stack", c);
	disposeC();
	expect(getMessageRenderer("stack")).toBe(b);
	disposeB();
	expect(getMessageRenderer("stack")).toBeUndefined();
});
