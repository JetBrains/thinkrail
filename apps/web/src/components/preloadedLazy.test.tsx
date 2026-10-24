import { expect, test } from "bun:test";
import { lazy, type ReactNode, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { preloadedLazy } from "./preloadedLazy";

function Greeting({ name }: { name: string }) {
	return <p>hello {name}</p>;
}

const render = (node: ReactNode) =>
	renderToStaticMarkup(<Suspense fallback={<p>loading</p>}>{node}</Suspense>);

test("loads only on preload, once, and renders without suspending once loaded", async () => {
	let calls = 0;
	const load = Promise.resolve({ default: Greeting });
	const Preloaded = preloadedLazy(() => {
		calls += 1;
		return load;
	});
	expect(calls).toBe(0);
	await Preloaded.preload();
	await Preloaded.preload();
	expect(calls).toBe(1);
	expect(render(<Preloaded name="chat" />)).toBe("<p>hello chat</p>");
});

test("canary: React.lazy still suspends after its module resolved, which preloadedLazy exists to avoid", async () => {
	const load = Promise.resolve({ default: Greeting });
	const Lazy = lazy(() => load);
	await load;
	expect(render(<Lazy name="chat" />)).toContain("loading");
});

test("suspends while the module is still loading", () => {
	const Preloaded = preloadedLazy(() => new Promise<{ default: typeof Greeting }>(() => {}));
	void Preloaded.preload();
	expect(render(<Preloaded name="chat" />)).toContain("loading");
});

test("a failed load is not retried by renders, only by the next preload", async () => {
	let calls = 0;
	const Preloaded = preloadedLazy(() => {
		calls += 1;
		return calls === 1
			? Promise.reject(new Error("Failed to fetch dynamically imported module"))
			: Promise.resolve({ default: Greeting });
	});
	await Preloaded.preload().catch(() => undefined);
	render(<Preloaded name="chat" />);
	render(<Preloaded name="chat" />);
	expect(calls).toBe(1);
	await Preloaded.preload();
	expect(calls).toBe(2);
	expect(render(<Preloaded name="chat" />)).toBe("<p>hello chat</p>");
});

test("a failed preload with nothing rendered is not an unhandled rejection", async () => {
	const unhandled: unknown[] = [];
	const onUnhandled = (reason: unknown) => void unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	const Preloaded = preloadedLazy(() =>
		Promise.reject<{ default: typeof Greeting }>(
			new Error("Failed to fetch dynamically imported module"),
		),
	);
	void Preloaded.preload();
	await new Promise((resolve) => setTimeout(resolve, 10));
	process.off("unhandledRejection", onUnhandled);
	expect(unhandled).toEqual([]);
});
