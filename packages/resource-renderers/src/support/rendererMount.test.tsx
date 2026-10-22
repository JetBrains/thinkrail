import { afterEach, expect, test } from "bun:test";
import { type ReactNode, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceEnvironmentProvider, type ResourceHost, ResourceHostProvider } from "../host";
import {
	describeResource,
	PENDING_TEXT_META,
	type ResourceDescriptor,
	type ResourceRenderer,
	type ResourceViewModule,
	registerResourceRenderer,
} from "../registry";
import { codeRenderer } from "../renderers/code";
import { preloadRendererView, RendererView, usePreloadResourceView } from "./rendererMount";

const host: ResourceHost = {
	markdown: () => null,
	code: { languages: [], languageId: () => null, theme: () => ({ name: "test", settings: [] }) },
	bytesUrl: () => "",
	openFile: () => {},
	openComparison: () => {},
	readFile: async () => ({ content: "" }),
	subscribeFileChanges: () => () => {},
	FileReview: () => null,
	ReviewSend: () => null,
};

const cleanups: (() => void)[] = [];
let sequence = 0;

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function testRenderer(load: (mobile: boolean) => Promise<ResourceViewModule>) {
	sequence += 1;
	const extension = `preload${sequence}`;
	const calls: boolean[] = [];
	const renderer: ResourceRenderer = {
		id: `test/preload-${sequence}`,
		labelKey: "viewer.renderer.preview",
		match: { glob: [`*.${extension}`] },
		rank: 10_000,
		capabilities: {
			view: true,
			diff: false,
			anchors: { view: [], diff: [] },
			mobile: true,
			copy: false,
			layout: false,
			whitespace: false,
		},
		loadView: ({ mobile }) => {
			calls.push(mobile);
			return load(mobile);
		},
	};
	cleanups.push(registerResourceRenderer(renderer));
	const resource = describeResource("ws", `file.${extension}`, PENDING_TEXT_META);
	return { renderer, calls, resource };
}

function viewModule(label: string, warm?: ResourceViewModule["warm"]): ResourceViewModule {
	return { default: () => <span>{label}</span>, ...(warm ? { warm } : {}) };
}

function render(renderer: ResourceRenderer, resource: ResourceDescriptor, mobile = false) {
	return renderToStaticMarkup(
		<Suspense fallback={<i>loading</i>}>
			<RendererView
				renderer={renderer}
				mobile={mobile}
				resource={resource}
				content={{ kind: "text", text: "", hash: "h" }}
			/>
		</Suspense>,
	);
}

test("a preloaded view renders without suspending", async () => {
	const { renderer, resource } = testRenderer(async () => viewModule("ready"));
	await preloadRendererView(renderer, false, host, resource);
	expect(render(renderer, resource)).toBe("<span>ready</span>");
});

test("a view that was not preloaded shows the Suspense fallback", () => {
	const { renderer, resource } = testRenderer(() => new Promise(() => {}));
	expect(render(renderer, resource)).toContain("loading");
});

test("a failed preload does not reject and a later mount retries the loader", async () => {
	let attempt = 0;
	const { renderer, calls, resource } = testRenderer(async () => {
		attempt += 1;
		if (attempt === 1) throw new Error("chunk failed");
		return viewModule("retried");
	});
	await preloadRendererView(renderer, false, host, resource);
	expect(calls).toEqual([false]);
	expect(render(renderer, resource)).toContain("loading");
	expect(calls).toEqual([false, false]);
});

test("a warm that throws does not reject and the view still renders", async () => {
	const { renderer, resource } = testRenderer(async () =>
		viewModule("warm failed", () => {
			throw new Error("warm failed");
		}),
	);
	await expect(preloadRendererView(renderer, false, host, resource)).resolves.toBeUndefined();
	expect(render(renderer, resource)).toBe("<span>warm failed</span>");
});

test("concurrent preloads import once and warm each request", async () => {
	const warmed: [ResourceHost, string][] = [];
	const { renderer, calls, resource } = testRenderer(async () =>
		viewModule("once", (warmHost, warmResource) => warmed.push([warmHost, warmResource.path])),
	);
	await Promise.all([
		preloadRendererView(renderer, false, host, resource),
		preloadRendererView(renderer, false, host, { ...resource, path: "other.file" }),
	]);
	expect(calls).toEqual([false]);
	expect(warmed).toEqual([
		[host, resource.path],
		[host, "other.file"],
	]);
});

test("warm runs in a later task than the loaded module", async () => {
	const order: string[] = [];
	const { renderer, resource } = testRenderer(async () =>
		viewModule("yielded", () => order.push("warm")),
	);
	const preload = preloadRendererView(renderer, false, host, resource);
	setTimeout(() => order.push("task"), 0);
	await preload;
	expect(order).toEqual(["task", "warm"]);
});

test("phone and desktop implementations load and cache separately", async () => {
	const { renderer, calls, resource } = testRenderer(async (mobile) =>
		viewModule(mobile ? "phone" : "desktop"),
	);
	await preloadRendererView(renderer, false, host, resource);
	expect(render(renderer, resource, true)).toContain("loading");
	expect(calls).toEqual([false, true]);
	expect(render(renderer, resource, false)).toBe("<span>desktop</span>");
});

function capturePreload(wrap: (probe: ReactNode) => ReactNode) {
	const captured: ((target: ResourceDescriptor) => void)[] = [];
	function Probe() {
		captured.push(usePreloadResourceView());
		return null;
	}
	renderToStaticMarkup(wrap(<Probe />));
	const preload = captured[0];
	if (!preload) throw new Error("Probe did not render");
	return preload;
}

test("usePreloadResourceView resolves the renderer for the environment", () => {
	cleanups.push(registerResourceRenderer(codeRenderer));
	const { calls, resource } = testRenderer(async () => viewModule("hook"));
	const preload = capturePreload((probe) => (
		<ResourceHostProvider value={host}>
			<ResourceEnvironmentProvider value={{ mobile: true }}>{probe}</ResourceEnvironmentProvider>
		</ResourceHostProvider>
	));
	preload(resource);
	expect(calls).toEqual([true]);
});
