import { Bot, Check, CircleUser, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Step = { i: number; duration: number; waiting?: boolean; back?: boolean };

type Lane = {
	name: string;
	start: number;
	activities: string[];
	steps: Step[];
};

const LANES: Lane[] = [
	{
		name: "agent-01",
		start: 571,
		activities: ["Read API spec", "Inspect existing routes", "Implement endpoint", "Run tests"],
		steps: [
			{ i: 0, duration: 1048 },
			{ i: 1, duration: 1334 },
			{ i: 2, duration: 1714 },
			{ i: 3, duration: 1429 },
		],
	},
	{
		name: "agent-02",
		start: 857,
		activities: ["Read UI spec", "Inspect components", "Build share dialog", "Polish states"],
		steps: [
			{ i: 0, duration: 1429 },
			{ i: 1, duration: 1143 },
			{ i: 2, duration: 2095 },
			{ i: 3, duration: 1524 },
		],
	},
	{
		name: "agent-03",
		start: 1143,
		activities: [
			"Inspect current copy",
			"Draft empty state",
			"Waiting for input",
			"Apply user choice",
		],
		steps: [
			{ i: 0, duration: 1238 },
			{ i: 1, duration: 1619 },
			{ i: 2, duration: 2476, waiting: true },
			{ i: 1, duration: 1334, back: true },
			{ i: 2, duration: 762 },
			{ i: 3, duration: 1143 },
		],
	},
];

const MAIN_DRAW = 429;
const BRANCH_DRAW = 381;
const CARD_DRAW = 238;
const LINK_DRAW = 152;
const BACK_DRAW = 200;

type Tween = { id: string; from: number; to: number; start: number; dur: number };
type Ev = { at: number; lane: number; index: number; done?: boolean };

type Timeline = { tweens: Tween[]; events: Ev[]; total: number };

function buildTimeline(): Timeline {
	const tweens: Tween[] = [];
	const events: Ev[] = [];
	let total = MAIN_DRAW;

	tweens.push({ id: "main", from: 0, to: 1, start: 0, dur: MAIN_DRAW });

	LANES.forEach((lane, li) => {
		let t = lane.start;
		tweens.push({ id: `branch-${li}`, from: 0, to: 1, start: t, dur: BRANCH_DRAW });
		t += BRANCH_DRAW;

		let prev: number | null = null;
		lane.steps.forEach((step) => {
			if (prev === null) {
				tweens.push({ id: `card-${li}-${step.i}`, from: 0, to: 1, start: t, dur: CARD_DRAW });
				t += CARD_DRAW;
			} else if (step.i > prev) {
				for (let j = prev; j < step.i; j++) {
					tweens.push({ id: `link-${li}-${j}`, from: 0, to: 1, start: t, dur: LINK_DRAW });
					t += LINK_DRAW;
					tweens.push({ id: `card-${li}-${j + 1}`, from: 0, to: 1, start: t, dur: CARD_DRAW });
					t += CARD_DRAW;
				}
			} else {
				for (let j = prev; j > step.i; j--) {
					tweens.push({ id: `card-${li}-${j}`, from: 1, to: 0, start: t, dur: BACK_DRAW * 0.6 });
					tweens.push({
						id: `link-${li}-${j - 1}`,
						from: 1,
						to: 0,
						start: t + BACK_DRAW * 0.4,
						dur: BACK_DRAW * 0.6,
					});
					t += BACK_DRAW;
				}
			}
			events.push({ at: t, lane: li, index: step.i });
			prev = step.i;
			t += step.duration;
		});

		const last = lane.activities.length - 1;
		tweens.push({ id: `link-${li}-${last}`, from: 0, to: 1, start: t, dur: LINK_DRAW });
		t += LINK_DRAW;
		tweens.push({ id: `pr-${li}`, from: 0, to: 1, start: t, dur: CARD_DRAW });
		t += CARD_DRAW;
		events.push({ at: t, lane: li, index: lane.activities.length, done: true });
		total = Math.max(total, t + 857);
	});

	return { tweens, events, total };
}

const TIMELINE = buildTimeline();

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

function progressAt(elapsed: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const tw of TIMELINE.tweens) {
		if (elapsed <= tw.start) {
			if (!(tw.id in out)) out[tw.id] = tw.from;
			continue;
		}
		const p = Math.min(1, (elapsed - tw.start) / tw.dur);
		out[tw.id] = tw.from + (tw.to - tw.from) * easeInOut(p);
	}
	return out;
}

function statesAt(elapsed: number): { index: number; done: boolean }[] {
	const states = LANES.map(() => ({ index: -1, done: false }));
	for (const ev of TIMELINE.events) {
		if (elapsed >= ev.at) states[ev.lane] = { index: ev.index, done: !!ev.done };
	}
	return states;
}

const finalProgress = (): Record<string, number> => progressAt(TIMELINE.total + 1);
const queuedLaneState = { index: -1, done: false } as const;

function StatusDot({ state }: { state: "done" | "active" | "waiting" | "queued" }) {
	if (state === "done")
		return <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />;
	if (state === "waiting")
		return <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-warn" />;
	if (state === "active")
		return <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" />;
	return <LoaderCircle className="h-4 w-4 shrink-0 text-text-disabled" />;
}

type Geometry = {
	width: number;
	height: number;
	paths: { id: string; d: string }[];
};

function rectHalves(l: number, t: number, r: number, b: number) {
	const cy = (t + b) / 2;
	const rad = Math.min(4, (r - l) / 2, (b - t) / 2);
	const top = [
		`M ${l} ${cy}`,
		`L ${l} ${t + rad}`,
		`Q ${l} ${t} ${l + rad} ${t}`,
		`L ${r - rad} ${t}`,
		`Q ${r} ${t} ${r} ${t + rad}`,
		`L ${r} ${cy}`,
	].join(" ");
	const bottom = [
		`M ${l} ${cy}`,
		`L ${l} ${b - rad}`,
		`Q ${l} ${b} ${l + rad} ${b}`,
		`L ${r - rad} ${b}`,
		`Q ${r} ${b} ${r} ${b - rad}`,
		`L ${r} ${cy}`,
	].join(" ");
	return { top, bottom };
}

const DIAGRAM_WIDTH = 1000;

export function Orchestration() {
	const wrapRef = useRef<HTMLDivElement>(null);
	const outerRef = useRef<HTMLDivElement>(null);
	const sectionRef = useRef<HTMLElement>(null);
	const mainRef = useRef<HTMLSpanElement>(null);
	const nodes = useRef(new Map<string, HTMLElement>());
	const [geo, setGeo] = useState<Geometry | null>(null);
	const [started, setStarted] = useState(false);
	const [reduced, setReduced] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [progress, setProgress] = useState<Record<string, number>>({});
	const [lanes, setLanes] = useState(() => LANES.map(() => ({ index: -1, done: false })));

	useEffect(() => {
		const mq = window.matchMedia("(max-width: 767px)");
		const apply = () => setIsMobile(mq.matches);
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, []);

	const setNode = useCallback(
		(id: string) => (el: HTMLElement | null) => {
			if (el) nodes.current.set(id, el);
			else nodes.current.delete(id);
		},
		[],
	);

	const measure = useCallback(() => {
		const outer = outerRef.current;
		const wrap = wrapRef.current;
		const main = mainRef.current;
		if (!wrap || !main) return;
		const scale = outer?.clientWidth ? Math.min(1, outer.clientWidth / DIAGRAM_WIDTH) : 1;
		outer?.style.setProperty("--diagram-height", `${wrap.scrollHeight * scale}px`);
		wrap.style.setProperty("--diagram-scale", String(scale));
		const base = wrap.getBoundingClientRect();
		const k = wrap.offsetWidth > 0 ? base.width / wrap.offsetWidth || 1 : 1;
		const rel = (el: Element) => {
			const r = el.getBoundingClientRect();
			return {
				l: (r.left - base.left) / k,
				t: (r.top - base.top) / k,
				r: (r.right - base.left) / k,
				b: (r.bottom - base.top) / k,
				cy: (r.top - base.top + r.height / 2) / k,
			};
		};

		const paths: { id: string; d: string }[] = [];
		const m = rel(main);

		LANES.forEach((lane, li) => {
			const first = nodes.current.get(`card-${li}-0`);
			if (!first) return;
			const f = rel(first);
			const branchX = m.l + 10;
			const labelEl = nodes.current.get(`label-${li}`);
			const lab = labelEl ? rel(labelEl) : null;
			const endX = lab ? lab.l - 8 : branchX + 20;
			const rad = Math.min(8, Math.max(0, endX - branchX), Math.max(0, f.cy - m.b));
			paths.push({
				id: `branch-${li}`,
				d: `M ${branchX} ${m.b} L ${branchX} ${f.cy - rad} Q ${branchX} ${f.cy} ${branchX + rad} ${f.cy} L ${endX} ${f.cy}`,
			});

			lane.activities.forEach((_, ai) => {
				const el = nodes.current.get(`card-${li}-${ai}`);
				if (!el) return;
				const c = rel(el);
				const halves = rectHalves(c.l, c.t, c.r, c.b);
				paths.push({ id: `card-${li}-${ai}`, d: halves.top });
				paths.push({ id: `card-${li}-${ai}-b`, d: halves.bottom });

				const nextEl =
					ai === lane.activities.length - 1
						? nodes.current.get(`pr-${li}`)
						: nodes.current.get(`card-${li}-${ai + 1}`);
				if (nextEl) {
					const n = rel(nextEl);
					paths.push({ id: `link-${li}-${ai}`, d: `M ${c.r} ${c.cy} L ${n.l} ${n.cy}` });
				}
			});
		});

		setGeo({ width: wrap.scrollWidth, height: wrap.scrollHeight, paths });
	}, []);

	useLayoutEffect(() => {
		measure();
		const ro = new ResizeObserver(() => measure());
		if (wrapRef.current) ro.observe(wrapRef.current);
		if (outerRef.current) ro.observe(outerRef.current);
		window.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [measure, isMobile]);

	useEffect(() => {
		const el = sectionRef.current;
		if (!el) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setReduced(true);
			setProgress(finalProgress());
			setLanes(LANES.map((l) => ({ index: l.activities.length, done: true })));
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					setStarted(true);
					io.disconnect();
				}
			},
			{ threshold: 0, rootMargin: "0px 0px -15% 0px" },
		);

		io.observe(el);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		if (!started || reduced) return;
		let raf = 0;
		const t0 = performance.now();
		const tick = (now: number) => {
			const elapsed = now - t0;
			setProgress(progressAt(elapsed));
			setLanes(statesAt(elapsed));
			if (elapsed < TIMELINE.total) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [started, reduced]);

	useLayoutEffect(() => {
		const elements = sectionRef.current?.querySelectorAll<HTMLElement>("[data-progress-id]");
		for (const element of elements ?? []) {
			const id = element.dataset.progressId;
			element.style.setProperty("--orchestration-progress", String(id ? (progress[id] ?? 0) : 0));
		}
	}, [progress]);

	const laneState = (li: number, ai: number): "done" | "active" | "waiting" | "queued" => {
		const st = lanes[li] ?? queuedLaneState;
		const waitingIndex = LANES[li]?.steps.find((step) => step.waiting)?.i;
		if (st.index === ai) return waitingIndex === ai ? "waiting" : "active";
		return st.index > ai ? "done" : "queued";
	};

	const toneFor = (state: "done" | "active" | "waiting" | "queued") =>
		state === "queued"
			? "bg-container-workspace-bg text-text-disabled"
			: state === "done"
				? "bg-container-card-bg text-text-muted"
				: "bg-container-card-bg text-text-default";

	return (
		<section
			ref={sectionRef}
			id="orchestration"
			className="scroll-mt-16 border-b border-border-muted bg-container-header-bg"
		>
			<div className="mx-auto max-w-[1200px] px-6 py-8 sm:py-24">
				<p className="label-mono">Parallel workspace map</p>

				{isMobile ? (
					<div className="mt-8">
						<div className="flex items-start gap-2">
							<span className="flex min-w-0 flex-1 items-center rounded-sm border border-primary-muted bg-primary-subtle px-3 py-2 text-xs text-text-default">
								Project sharing · approved plan
							</span>
							<span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-text-default text-background">
								<CircleUser className="h-5 w-5" strokeWidth={1.5} />
							</span>
						</div>

						<span className="send-glow mt-4 inline-block w-fit rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">
							main
						</span>

						<div className="mt-0 flex flex-col">
							{LANES.slice(0, 2).map((lane, li) => {
								const st = lanes[li] ?? queuedLaneState;
								const last = li === 1;
								return (
									<div key={lane.name} className="flex">
										<div className="relative w-[26px] shrink-0">
											<span
												aria-hidden
												className={`absolute left-[10px] top-0 w-px bg-border-muted ${last ? "h-[36px]" : "h-full"}`}
											/>
											<span
												aria-hidden
												data-progress-id={`branch-${li}`}
												className={`orchestration-progress-y absolute left-[10px] top-0 w-px origin-top bg-primary transition-transform duration-300 ease-linear ${last ? "h-[36px]" : "h-full"}`}
											/>
											<span
												aria-hidden
												className="absolute left-[10px] top-[36px] h-px w-[16px] bg-border-muted"
											/>
											<span
												aria-hidden
												data-progress-id={`branch-${li}`}
												className="orchestration-progress-x absolute left-[10px] top-[36px] h-px w-[16px] origin-left bg-primary transition-transform duration-300 ease-linear"
											/>
										</div>

										<div className="min-w-0 flex-1 pt-3 pb-0">
											<div className="rounded-lg border border-border-muted bg-background p-4">
												<span
													className={`flex min-w-0 items-center gap-2 text-xs transition-colors ${
														st.index >= 0 ? "text-text-default" : "text-text-disabled"
													}`}
												>
													<Bot className="h-5 w-5 shrink-0" strokeWidth={1.5} />
													<span className="truncate">{lane.name}</span>
												</span>

												<div className="mt-3 flex flex-col gap-1.5">
													{lane.activities.map((label, ai) => {
														const state = laneState(li, ai);
														return (
															<div
																key={label}
																className={`flex items-center gap-2 rounded px-3 py-2 transition-colors duration-500 ${toneFor(state)}`}
															>
																<StatusDot state={state} />
																<span className="min-w-0 flex-1 text-xs">{label}</span>
															</div>
														);
													})}
													<span
														className={`mt-1.5 flex items-center justify-center rounded border px-3 py-2 text-xs font-semibold transition-colors duration-500 ${
															st.done
																? "border-transparent bg-primary text-primary-foreground"
																: "border-text-disabled text-text-disabled"
														}`}
													>
														{`pr-0${li + 1}`}
													</span>
												</div>
											</div>
										</div>
									</div>
								);
							})}
						</div>

						<p className="mt-6 text-xs text-text-subtle">
							2 agents · 2 isolated worktrees · one repository
						</p>
					</div>
				) : (
					<div ref={outerRef} className="orchestration-outer relative mt-8 overflow-visible">
						<div ref={wrapRef} className="orchestration-canvas relative w-[1000px] origin-top-left">
							{geo && (
								<svg
									className="pointer-events-none absolute inset-0 z-0 overflow-visible"
									width={geo.width}
									height={geo.height}
									aria-hidden="true"
								>
									<g fill="none" strokeLinecap="round" strokeLinejoin="round">
										{geo.paths.map((p) => (
											<path
												key={`base-${p.id}`}
												d={p.d}
												stroke="var(--border-muted)"
												strokeWidth={1}
											/>
										))}
										{geo.paths.map((p) => {
											const v = progress[p.id] ?? progress[p.id.replace(/-b$/, "")] ?? 0;
											if (v <= 0) return null;
											return (
												<path
													key={`lit-${p.id}`}
													d={p.d}
													stroke="var(--primary)"
													strokeWidth={1}
													pathLength={1}
													strokeDasharray={1}
													strokeDashoffset={1 - v}
												/>
											);
										})}
									</g>
								</svg>
							)}

							<div className="relative z-10 flex items-center justify-between gap-3">
								<span
									ref={mainRef}
									className="send-glow rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"
								>
									main
								</span>
								<div className="flex shrink-0 items-center gap-2">
									<span className="flex h-[36px] items-center rounded-sm border border-primary-muted bg-primary-subtle px-3.5 text-xs text-text-default">
										Project sharing · approved plan
									</span>
									<span className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-text-default text-background">
										<CircleUser className="h-5 w-5" strokeWidth={1.5} />
									</span>
								</div>
							</div>

							<div className="relative z-10 mt-8">
								{LANES.map((lane, li) => {
									const st = lanes[li] ?? queuedLaneState;
									return (
										<div key={lane.name} className="pl-6">
											<div className="flex items-center gap-3 pt-5 pb-5">
												<span
													ref={setNode(`label-${li}`)}
													className={`flex w-[124px] shrink-0 items-center gap-2 text-xs transition-colors ${
														st.index >= 0 ? "text-text-default" : "text-text-disabled"
													}`}
												>
													<Bot className="h-6 w-6 shrink-0" strokeWidth={1.5} />
													{lane.name}
												</span>
												<div className="flex flex-1 items-center gap-4">
													{lane.activities.map((label, ai) => {
														const state = laneState(li, ai);
														return (
															<div
																key={label}
																ref={setNode(`card-${li}-${ai}`)}
																className={`relative flex h-[36px] min-w-0 flex-1 basis-0 items-center gap-2 overflow-hidden rounded px-3 py-2 transition-colors duration-500 ${toneFor(state)}`}
															>
																<StatusDot state={state} />
																<span className="truncate text-xs whitespace-nowrap">{label}</span>
															</div>
														);
													})}
													<span
														ref={setNode(`pr-${li}`)}
														className={`flex h-[36px] min-w-0 flex-1 basis-0 items-center justify-center overflow-hidden rounded border px-3 py-2 text-xs font-semibold transition-colors duration-500 ${
															st.done
																? "border-transparent bg-primary text-primary-foreground"
																: "border-text-disabled text-text-disabled"
														}`}
													>
														{`pr-0${li + 1}`}
													</span>
												</div>
											</div>
										</div>
									);
								})}
							</div>

							<p className="relative z-10 mt-6 text-xs text-text-subtle">
								3 agents · 3 isolated worktrees · one repository
							</p>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
