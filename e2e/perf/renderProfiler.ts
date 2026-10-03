import type { Page, Request, Route } from "@playwright/test";

export interface ComponentCost {
	commits: number;
	renders: number;
	selfTotalMs: number;
	selfMaxMs: number;
	inclusiveTotalMs: number;
	inclusiveMaxMs: number;
}

export interface RenderProfile {
	commits: number;
	totalMs: number;
	maxCommitMs: number;
	components: Record<string, ComponentCost>;
}

interface RenderProfilerHandle {
	reset: () => void;
	snapshot: () => RenderProfile;
}

declare global {
	interface Window {
		__thinkrailRenderProfiler?: RenderProfilerHandle;
	}
}

function installRenderProfiler(): void {
	interface Fiber {
		tag: number;
		type: unknown;
		flags: number;
		child: Fiber | null;
		sibling: Fiber | null;
		alternate: Fiber | null;
		actualDuration?: number;
		selfBaseDuration?: number;
	}
	interface FiberRoot {
		current: Fiber;
	}
	interface CommitCost {
		renders: number;
		selfMs: number;
		inclusiveMs: number;
	}

	const FUNCTION_COMPONENT = 0;
	const CLASS_COMPONENT = 1;
	const FORWARD_REF = 11;
	const SIMPLE_MEMO_COMPONENT = 15;
	const PERFORMED_WORK = 1;

	let commits = 0;
	let totalMs = 0;
	let maxCommitMs = 0;
	let components: Record<string, ComponentCost> = {};

	function componentName(fiber: Fiber): string | null {
		const type = fiber.type as
			| { displayName?: string; name?: string; render?: { displayName?: string; name?: string } }
			| null
			| undefined;
		if (!type) return null;
		if (fiber.tag === FORWARD_REF)
			return type.displayName || type.render?.displayName || type.render?.name || null;
		return type.displayName || type.name || null;
	}

	function isComponent(tag: number): boolean {
		return (
			tag === FUNCTION_COMPONENT ||
			tag === CLASS_COMPONENT ||
			tag === FORWARD_REF ||
			tag === SIMPLE_MEMO_COMPONENT
		);
	}

	function collect(
		fiber: Fiber,
		owner: string,
		perCommit: Map<string, CommitCost>,
		open: Map<string, number>,
	): void {
		const previous = fiber.alternate;
		const mounted = previous === null;
		const component = isComponent(fiber.tag);
		const label = component ? (componentName(fiber) ?? `${owner}>anonymous`) : owner;
		const name = component && (mounted || (fiber.flags & PERFORMED_WORK) !== 0) ? label : null;
		if (name) {
			const cost = perCommit.get(name) ?? { renders: 0, selfMs: 0, inclusiveMs: 0 };
			cost.renders += 1;
			cost.selfMs += fiber.selfBaseDuration ?? 0;
			if (!open.get(name)) cost.inclusiveMs += fiber.actualDuration ?? 0;
			perCommit.set(name, cost);
			open.set(name, (open.get(name) ?? 0) + 1);
		}
		if (mounted || fiber.child !== previous.child)
			for (let child = fiber.child; child !== null; child = child.sibling)
				collect(child, label, perCommit, open);
		if (name) open.set(name, (open.get(name) ?? 1) - 1);
	}

	function onCommitFiberRoot(_rendererId: number, root: FiberRoot): void {
		const perCommit = new Map<string, CommitCost>();
		collect(root.current, "root", perCommit, new Map());
		const commitMs = root.current.actualDuration ?? 0;
		commits += 1;
		totalMs += commitMs;
		maxCommitMs = Math.max(maxCommitMs, commitMs);
		for (const [name, cost] of perCommit) {
			const entry = components[name] ?? {
				commits: 0,
				renders: 0,
				selfTotalMs: 0,
				selfMaxMs: 0,
				inclusiveTotalMs: 0,
				inclusiveMaxMs: 0,
			};
			entry.commits += 1;
			entry.renders += cost.renders;
			entry.selfTotalMs += cost.selfMs;
			entry.selfMaxMs = Math.max(entry.selfMaxMs, cost.selfMs);
			entry.inclusiveTotalMs += cost.inclusiveMs;
			entry.inclusiveMaxMs = Math.max(entry.inclusiveMaxMs, cost.inclusiveMs);
			components[name] = entry;
		}
	}

	const noop = () => {};
	Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
		configurable: true,
		value: {
			supportsFiber: true,
			isDisabled: false,
			renderers: new Map(),
			inject: () => 1,
			checkDCE: noop,
			onCommitFiberRoot,
			onCommitFiberUnmount: noop,
			onPostCommitFiberRoot: noop,
			setStrictMode: noop,
		},
	});
	window.__thinkrailRenderProfiler = {
		reset: () => {
			commits = 0;
			totalMs = 0;
			maxCommitMs = 0;
			components = {};
		},
		snapshot: () => structuredClone({ commits, totalMs, maxCommitMs, components }),
	};
}

const ISOLATION_HEADERS = {
	"cross-origin-opener-policy": "same-origin",
	"cross-origin-embedder-policy": "require-corp",
};

function needsIsolationHeaders(request: Request): boolean {
	return request.resourceType() === "document" || /\.m?js$/.test(new URL(request.url()).pathname);
}

async function isolate(route: Route): Promise<void> {
	if (!needsIsolationHeaders(route.request())) return route.fallback();
	try {
		const response = await route.fetch();
		await route.fulfill({ response, headers: { ...response.headers(), ...ISOLATION_HEADERS } });
	} catch {
		await route.abort().catch(() => {});
	}
}

export async function attachRenderProfiler(page: Page, origin: string): Promise<void> {
	await page.route(`${origin}/**`, isolate);
	await page.addInitScript(installRenderProfiler);
}

export async function detachRenderProfiler(page: Page): Promise<void> {
	await page.unrouteAll({ behavior: "ignoreErrors" });
}

export async function assertPreciseTimers(page: Page): Promise<void> {
	if (!(await page.evaluate(() => crossOriginIsolated)))
		throw new Error("page is not cross-origin isolated; React durations would use coarse timers");
}

export async function resetRenderProfile(page: Page): Promise<void> {
	await page.evaluate(() => {
		const profiler = window.__thinkrailRenderProfiler;
		if (!profiler) throw new Error("render profiler is not installed");
		profiler.reset();
	});
}

export async function readRenderProfile(page: Page): Promise<RenderProfile> {
	return page.evaluate(() => {
		const profiler = window.__thinkrailRenderProfiler;
		if (!profiler) throw new Error("render profiler is not installed");
		return profiler.snapshot();
	});
}

export async function assertProfilingBuild(page: Page): Promise<void> {
	const profile = await readRenderProfile(page);
	if (profile.commits === 0 || profile.totalMs <= 0)
		throw new Error(
			"no profiled commits: the host is not serving the react-dom profiling build (apps/web build:profile)",
		);
}
