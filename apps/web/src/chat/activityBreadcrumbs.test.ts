import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityBreadcrumbDescriptor } from "./activityBreadcrumbs";
import * as breadcrumbModule from "./activityBreadcrumbs";

interface GeometryNode extends ActivityBreadcrumbDescriptor {
	top: number;
	bottom: number;
}

type DerivePath = (nodes: GeometryNode[], boundary: number) => ActivityBreadcrumbDescriptor[];
type CompressPath = (
	path: ActivityBreadcrumbDescriptor[],
	compact: boolean,
) => Array<ActivityBreadcrumbDescriptor | { kind: "ellipsis"; id: "ellipsis" }>;

function requiredFunction<T>(name: string): T {
	const candidate = Reflect.get(breadcrumbModule, name);
	expect(typeof candidate).toBe("function");
	return candidate as T;
}

const node = (
	id: string,
	kind: ActivityBreadcrumbDescriptor["kind"],
	top: number,
	bottom: number,
	parentId?: string,
): GeometryNode => ({
	id,
	...(parentId ? { parentId } : {}),
	kind,
	label: id,
	meta: "",
	expanded: true,
	top,
	bottom,
});

describe("activity breadcrumb path", () => {
	test("derives the deepest connected expanded path crossing the sticky boundary", () => {
		const derive = requiredFunction<DerivePath>("deriveActiveBreadcrumbPath");
		const path = derive(
			[
				node("activity", "activity", -100, 500),
				node("thinking", "thinking", -60, 400, "activity"),
				node("tool", "tool", -20, 300, "thinking"),
				node("next-thinking", "thinking", 320, 480, "activity"),
			],
			0,
		);

		expect(path.map((segment) => segment.id)).toEqual(["activity", "thinking", "tool"]);
	});

	test("removes folded nodes and ends the trail outside an expanded subtree", () => {
		const derive = requiredFunction<DerivePath>("deriveActiveBreadcrumbPath");
		const foldedTool = { ...node("tool", "tool", -20, 300, "thinking"), expanded: false };
		expect(
			derive(
				[
					node("activity", "activity", -100, 500),
					node("thinking", "thinking", -60, 400, "activity"),
					foldedTool,
				],
				0,
			).map((segment) => segment.id),
		).toEqual(["activity", "thinking"]);
		expect(derive([node("past", "activity", -500, -1)], 0)).toEqual([]);
	});

	test("compresses only middle ancestry while preserving root and active leaf", () => {
		const compress = requiredFunction<CompressPath>("compressBreadcrumbPath");
		const path = [
			node("activity", "activity", 0, 1),
			node("thinking", "thinking", 0, 1, "activity"),
			node("tool", "tool", 0, 1, "thinking"),
		];
		expect(compress(path, false).map((segment) => segment.id)).toEqual([
			"activity",
			"thinking",
			"tool",
		]);
		expect(compress(path, true).map((segment) => segment.id)).toEqual([
			"activity",
			"ellipsis",
			"tool",
		]);
	});

	test("uses one-line middle compression only on narrow scrollers", () => {
		const isCompact = requiredFunction<(width: number) => boolean>("isCompactBreadcrumbWidth");
		expect(isCompact(768)).toBe(false);
		expect(isCompact(390)).toBe(true);
	});

	test("aligns jump targets immediately below the sticky row", () => {
		const jumpTop = requiredFunction<
			(scrollTop: number, scrollerTop: number, nodeTop: number) => number
		>("activityBreadcrumbJumpTop");
		expect(jumpTop(600, 100, 420)).toBe(886);
		expect(jumpTop(10, 100, 80)).toBe(0);
	});

	test("mounts no sticky overlay until a transcript scroller is available", () => {
		const Trail =
			requiredFunction<ComponentType<{ scroller: HTMLElement | null }>>("ActivityBreadcrumbTrail");
		expect(renderToStaticMarkup(createElement(Trail, { scroller: null }))).toBe("");
	});

	test("renders one labelled root-to-leaf navigation row with separate fold controls", () => {
		type BarProps = {
			segments: ActivityBreadcrumbDescriptor[];
			onJump: (id: string) => void;
			onToggle: (id: string) => void;
		};
		const Bar = requiredFunction<ComponentType<BarProps>>("ActivityBreadcrumbBar");
		const html = renderToStaticMarkup(
			createElement(Bar, {
				segments: [
					{ ...node("7 steps", "activity", 0, 1), meta: "read ×4" },
					{ ...node("Thinking", "thinking", 0, 1, "7 steps"), meta: "1 step · bash" },
					{ ...node("bash", "tool", 0, 1, "Thinking"), meta: "bun test watch.test.ts" },
				],
				onJump: () => {},
				onToggle: () => {},
			}),
		);

		expect(html).toContain('aria-label="Current chat activity path"');
		expect(html).toContain('data-testid="activity-breadcrumb-trail"');
		expect(html).toContain('aria-label="Jump to Thinking"');
		expect(html).toContain('aria-label="Collapse Thinking"');
		expect(html).toContain("bun test watch.test.ts");
	});
});
