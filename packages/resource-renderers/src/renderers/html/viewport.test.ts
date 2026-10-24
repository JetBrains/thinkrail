import { expect, test } from "bun:test";
import { htmlFrameGeometry, htmlViewport } from "./viewport";

test("a design width scales down to the box and never up", () => {
	expect(htmlFrameGeometry("desktop", { width: 640, height: 480 })).toEqual({
		width: 1280,
		height: 960,
		scale: 0.5,
	});
	expect(htmlFrameGeometry("phone", { width: 800, height: 480 })).toEqual({
		width: 390,
		height: 480,
		scale: 1,
	});
});

test("fill and an unmeasured box keep the box size unscaled", () => {
	expect(htmlFrameGeometry("responsive", { width: 640, height: 480 })).toEqual({
		width: 640,
		height: 480,
		scale: 1,
	});
	expect(htmlFrameGeometry("desktop", { width: 0, height: 0 }).scale).toBe(1);
});

test("the persisted viewport is read defensively and defaults to desktop", () => {
	expect(htmlViewport({ viewport: "tablet" })).toBe("tablet");
	expect(htmlViewport({ viewport: "watch" })).toBe("desktop");
	expect(htmlViewport(undefined)).toBe("desktop");
});
