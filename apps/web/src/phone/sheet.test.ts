import { afterEach, expect, test } from "bun:test";
import { closeTopLayer } from "./sheet";

const realDocument = globalThis.document;
const realKeyboardEvent = globalThis.KeyboardEvent;

afterEach(() => {
	globalThis.document = realDocument;
	globalThis.KeyboardEvent = realKeyboardEvent;
});

function fakeDocument(layerOpen: boolean): string[] {
	const sent: string[] = [];
	globalThis.KeyboardEvent = class extends Event {
		readonly key: string;
		constructor(type: string, init: KeyboardEventInit) {
			super(type, init);
			this.key = init.key ?? "";
		}
	} as unknown as typeof KeyboardEvent;
	globalThis.document = {
		querySelector: (selector: string) =>
			layerOpen && selector === '[data-modal-layer][data-state="open"]' ? {} : null,
		dispatchEvent: (event: KeyboardEvent) => {
			sent.push(`${event.type}:${event.key}`);
			return true;
		},
	} as unknown as Document;
	return sent;
}

test("the back button closes an open sheet or page with Escape instead of leaving the screen", () => {
	const sent = fakeDocument(true);
	expect(closeTopLayer()).toBe(true);
	expect(sent).toEqual(["keydown:Escape"]);
});

test("with nothing open the back button falls through to the screen stack", () => {
	const sent = fakeDocument(false);
	expect(closeTopLayer()).toBe(false);
	expect(sent).toEqual([]);
});
