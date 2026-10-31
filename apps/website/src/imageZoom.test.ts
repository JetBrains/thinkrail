import { describe, expect, test } from "bun:test";
import { zoomsInPlace } from "./imageZoom";

const plainClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("zoomsInPlace", () => {
	test("zooms on a plain primary click, including Enter on the link", () => {
		expect(zoomsInPlace(plainClick)).toBe(true);
	});

	test("follows the link on modified clicks", () => {
		for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
			expect(zoomsInPlace({ ...plainClick, [modifier]: true })).toBe(false);
		}
	});

	test("follows the link on a non-primary button", () => {
		expect(zoomsInPlace({ ...plainClick, button: 1 })).toBe(false);
	});
});
