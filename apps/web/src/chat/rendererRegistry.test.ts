import { expect, test } from "bun:test";
import { registerMessageRenderer, subscribeRendererRegistry } from "./rendererRegistry";

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
