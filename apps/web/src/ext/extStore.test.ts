import { beforeEach, expect, test } from "bun:test";
import type { ExtensionInfo } from "@thinkrail/contracts";
import {
	blockedTitlesByProject,
	selectBlocked,
	selectExtension,
	selectSurface,
	selectSurfaces,
	surfaceTitle,
	useExtStore,
} from "./extStore";

const info = (name: string, overrides: Partial<ExtensionInfo> = {}): ExtensionInfo => ({
	name,
	title: name.toUpperCase(),
	scope: "user",
	status: "active",
	generation: 1,
	build: "0123456789abcdef",
	permissions: [],
	themes: [],
	surfaces: [
		{ id: "main", slot: "panel", title: "Main" },
		{ id: "big", slot: "tab" },
		{ id: "bar", slot: "status" },
	],
	...overrides,
});

beforeEach(() => {
	useExtStore.setState({ hydration: "idle", extensions: {}, channels: {}, params: {} });
});

test("install replaces extensions and channels and marks the store ready", () => {
	const store = useExtStore.getState();
	store.applyChannel("old:key", 1);
	store.install([info("demo")], { "demo:count": 2 });
	const state = useExtStore.getState();
	expect(state.hydration).toBe("ready");
	expect(Object.keys(state.extensions)).toEqual(["demo"]);
	expect(state.channels).toEqual({ "demo:count": 2 });
});

test("removal drops the extension and only its own channel keys", () => {
	const store = useExtStore.getState();
	store.install([info("demo"), info("demo-two")], {
		"demo:a": 1,
		"demo-two:a": 2,
	});
	store.applyRemoved({ name: "demo" });
	const state = useExtStore.getState();
	expect(Object.keys(state.extensions)).toEqual(["demo-two"]);
	expect(state.channels).toEqual({ "demo-two:a": 2 });
	store.dropChannels(["demo-two:a"]);
	expect(useExtStore.getState().channels).toEqual({});
});

test("an unsupported host clears everything", () => {
	useExtStore.getState().install([info("demo")], { "demo:a": 1 });
	useExtStore.getState().markUnsupported();
	expect(useExtStore.getState()).toMatchObject({
		hydration: "unsupported",
		extensions: {},
		channels: {},
	});
});

test("surface selectors skip extensions without a build and sort by name", () => {
	const extensions = {
		zeta: info("zeta"),
		alpha: info("alpha"),
		broken: info("broken", { build: null, status: "error" }),
	};
	expect(
		selectSurfaces(extensions, ["panel"]).map(({ extension, surface }) => [
			extension.name,
			surface.id,
		]),
	).toEqual([
		["alpha", "main"],
		["zeta", "main"],
	]);
	const placed = selectSurface(extensions, "alpha", "big");
	expect(placed && surfaceTitle(placed)).toBe("ALPHA big");
	expect(selectSurface(extensions, "alpha", "nope")).toBeNull();
});

test("blocked extensions are scoped to their project and never offer surfaces", () => {
	const blocked = (name: string, projectId: string) =>
		info(name, { scope: "project", projectId, status: "blocked", generation: null, build: null });
	const extensions = {
		zed: blocked("zed", "p1"),
		alpha: blocked("alpha", "p1"),
		other: blocked("other", "p2"),
		live: info("live"),
	};
	expect(selectBlocked(extensions, "p1").map((ext) => ext.name)).toEqual(["alpha", "zed"]);
	expect(
		selectSurfaces(extensions, ["tab", "panel"]).map(({ extension }) => extension.name),
	).toEqual(["live", "live"]);
});

test("blocked copies are kept per project beside a loaded extension of the same name", () => {
	const blocked = (projectId: string) =>
		info("demo", {
			title: `Demo ${projectId}`,
			scope: "project",
			projectId,
			status: "blocked",
			generation: null,
			build: null,
		});
	const store = useExtStore.getState();
	store.install([info("demo"), blocked("a")], { "demo:count": 1 });
	store.applyChanged(blocked("b"));
	const { extensions } = useExtStore.getState();
	expect(blockedTitlesByProject(extensions)).toEqual({ a: ["Demo a"], b: ["Demo b"] });
	expect(selectExtension(extensions, "demo", "a")?.status).toBe("active");

	store.applyRemoved({ name: "demo", blockedProjectId: "a" });
	expect(useExtStore.getState().channels).toEqual({ "demo:count": 1 });
	store.applyRemoved({ name: "demo" });
	const state = useExtStore.getState();
	expect(state.channels).toEqual({});
	expect(Object.values(state.extensions).map((extension) => extension.projectId)).toEqual(["b"]);
	expect(selectExtension(state.extensions, "demo", "b")?.status).toBe("blocked");
	expect(selectExtension(state.extensions, "demo", "a")).toBeUndefined();
});
