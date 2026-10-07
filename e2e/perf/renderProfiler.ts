import type { Page, Request, Route } from "@playwright/test";

export interface ComponentCost {
	commits: number;
	renders: number;
	selfTotalMs: number;
	selfMaxMs: number;
	inclusiveTotalMs: number;
	inclusiveMaxMs: number;
}

interface SubtreeCost extends Omit<ComponentCost, "inclusiveTotalMs" | "inclusiveMaxMs"> {
	rootRenders: number;
}

export const MARKDOWN_SUBTREE = "markdown";

interface SubtreeRoots {
	[subtree: string]: string[];
}

interface LongTaskStats {
	count: number;
	totalMs: number;
	maxMs: number;
}

interface FrameStats {
	frames: number;
	p50GapMs: number;
	p95GapMs: number;
	maxGapMs: number;
	droppedFrames: number;
}

export interface RenderProfile {
	commits: number;
	totalMs: number;
	maxCommitMs: number;
	components: Record<string, ComponentCost>;
	subtrees: Record<string, SubtreeCost>;
	longTasks: LongTaskStats;
	frames: FrameStats;
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

function installRenderProfiler(subtreeRoots: SubtreeRoots): void {
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
	interface SubtreeCommitCost {
		renders: number;
		rootRenders: number;
		selfMs: number;
	}

	const FUNCTION_COMPONENT = 0;
	const CLASS_COMPONENT = 1;
	const FORWARD_REF = 11;
	const SIMPLE_MEMO_COMPONENT = 15;
	const PERFORMED_WORK = 1;

	const FRAME_MS = 1000 / 60;

	let commits = 0;
	let totalMs = 0;
	let maxCommitMs = 0;
	let components: Record<string, ComponentCost> = {};
	let subtrees: Record<string, SubtreeCost> = {};
	const subtreeByRoot = new Map(
		Object.entries(subtreeRoots).flatMap(([subtree, roots]) =>
			roots.map((root) => [root, subtree] as const),
		),
	);
	let longTasks: number[] = [];
	let frameGaps: number[] = [];
	let lastFrameAt = 0;

	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) longTasks.push(entry.duration);
	}).observe({ type: "longtask" });

	function onFrame(now: number): void {
		if (lastFrameAt > 0) frameGaps.push(now - lastFrameAt);
		lastFrameAt = now;
		requestAnimationFrame(onFrame);
	}
	requestAnimationFrame(onFrame);

	function percentile(sorted: number[], fraction: number): number {
		return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
	}

	function frameStats(): FrameStats {
		const sorted = [...frameGaps].sort((a, b) => a - b);
		return {
			frames: frameGaps.length,
			p50GapMs: percentile(sorted, 0.5),
			p95GapMs: percentile(sorted, 0.95),
			maxGapMs: sorted.at(-1) ?? 0,
			droppedFrames: frameGaps.reduce(
				(dropped, gap) => dropped + Math.max(0, Math.round(gap / FRAME_MS) - 1),
				0,
			),
		};
	}

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

	interface CommitWalk {
		perCommit: Map<string, CommitCost>;
		perSubtree: Map<string, SubtreeCommitCost>;
		open: Map<string, number>;
	}

	function collect(fiber: Fiber, owner: string, inSubtree: string | null, walk: CommitWalk): void {
		const previous = fiber.alternate;
		const mounted = previous === null;
		const component = isComponent(fiber.tag);
		const label = component ? (componentName(fiber) ?? `${owner}>anonymous`) : owner;
		const name = component && (mounted || (fiber.flags & PERFORMED_WORK) !== 0) ? label : null;
		const rootOf = component && inSubtree === null ? (subtreeByRoot.get(label) ?? null) : null;
		const subtree = inSubtree ?? rootOf;
		if (name) {
			const selfMs = fiber.selfBaseDuration ?? 0;
			const cost = walk.perCommit.get(name) ?? { renders: 0, selfMs: 0, inclusiveMs: 0 };
			cost.renders += 1;
			cost.selfMs += selfMs;
			if (!walk.open.get(name)) cost.inclusiveMs += fiber.actualDuration ?? 0;
			walk.perCommit.set(name, cost);
			walk.open.set(name, (walk.open.get(name) ?? 0) + 1);
			if (subtree) {
				const tree = walk.perSubtree.get(subtree) ?? { renders: 0, rootRenders: 0, selfMs: 0 };
				tree.renders += 1;
				if (rootOf) tree.rootRenders += 1;
				tree.selfMs += selfMs;
				walk.perSubtree.set(subtree, tree);
			}
		}
		if (mounted || fiber.child !== previous.child)
			for (let child = fiber.child; child !== null; child = child.sibling)
				collect(child, label, subtree, walk);
		if (name) walk.open.set(name, (walk.open.get(name) ?? 1) - 1);
	}

	function recordSubtrees(perSubtree: Map<string, SubtreeCommitCost>): void {
		for (const [subtree, cost] of perSubtree) {
			const entry = subtrees[subtree] ?? {
				commits: 0,
				renders: 0,
				rootRenders: 0,
				selfTotalMs: 0,
				selfMaxMs: 0,
			};
			entry.commits += 1;
			entry.renders += cost.renders;
			entry.rootRenders += cost.rootRenders;
			entry.selfTotalMs += cost.selfMs;
			entry.selfMaxMs = Math.max(entry.selfMaxMs, cost.selfMs);
			subtrees[subtree] = entry;
		}
	}

	function onCommitFiberRoot(_rendererId: number, root: FiberRoot): void {
		const perCommit = new Map<string, CommitCost>();
		const perSubtree = new Map<string, SubtreeCommitCost>();
		collect(root.current, "root", null, { perCommit, perSubtree, open: new Map() });
		recordSubtrees(perSubtree);
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
			subtrees = {};
			longTasks = [];
			frameGaps = [];
			lastFrameAt = 0;
		},
		snapshot: () =>
			structuredClone({
				commits,
				totalMs,
				maxCommitMs,
				components,
				subtrees,
				longTasks: {
					count: longTasks.length,
					totalMs: longTasks.reduce((sum, ms) => sum + ms, 0),
					maxMs: Math.max(0, ...longTasks),
				},
				frames: frameStats(),
			}),
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

export async function attachRenderProfiler(
	page: Page,
	origin: string,
	subtreeRoots: SubtreeRoots,
): Promise<void> {
	await page.route(`${origin}/**`, isolate);
	await page.addInitScript(installRenderProfiler, subtreeRoots);
}

export async function detachRenderProfiler(page: Page): Promise<void> {
	await page.unrouteAll({ behavior: "ignoreErrors" });
}

export interface MainThreadCost {
	taskMs: number;
	scriptMs: number;
	layoutMs: number;
	styleMs: number;
	heapDeltaMb: number;
}

const MAIN_THREAD_METRICS = {
	taskMs: "TaskDuration",
	scriptMs: "ScriptDuration",
	layoutMs: "LayoutDuration",
	styleMs: "RecalcStyleDuration",
} as const;

export async function startMainThreadProbe(page: Page, cpuRate: number) {
	const session = await page.context().newCDPSession(page);
	await session.send("Performance.enable");
	if (cpuRate !== 1) await session.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
	const sample = async () => {
		const { metrics } = await session.send("Performance.getMetrics");
		return new Map(metrics.map((metric) => [metric.name, metric.value]));
	};
	const before = await sample();
	return async (): Promise<MainThreadCost> => {
		const after = await sample();
		if (cpuRate !== 1) await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
		await session.detach();
		const delta = (name: string) => (after.get(name) ?? 0) - (before.get(name) ?? 0);
		return {
			taskMs: delta(MAIN_THREAD_METRICS.taskMs) * 1000,
			scriptMs: delta(MAIN_THREAD_METRICS.scriptMs) * 1000,
			layoutMs: delta(MAIN_THREAD_METRICS.layoutMs) * 1000,
			styleMs: delta(MAIN_THREAD_METRICS.styleMs) * 1000,
			heapDeltaMb: delta("JSHeapUsedSize") / 1024 / 1024,
		};
	};
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

export async function assertProfilingReady(page: Page): Promise<void> {
	if (!(await page.evaluate(() => crossOriginIsolated)))
		throw new Error("page is not cross-origin isolated; React durations would use coarse timers");
	const profile = await readRenderProfile(page);
	if (profile.commits === 0 || profile.totalMs <= 0)
		throw new Error(
			"no profiled commits: the host is not serving the react-dom profiling build (apps/web build:profile)",
		);
}
