const TURN_INSET_RATIO = 0.1;
const TURN_INSET_MIN = 48;
const TURN_INSET_MAX = 80;
const ADVANCE_DURATION_MS = 220;
const EDGE_STABILITY_FRAMES = 30;
const GEOMETRY_EPSILON = 0.5;

export type ReadingBandLatestEdge = "top" | "bottom";

export interface ReadingBandMovement {
	settle: number;
	trigger: number;
}

export interface ReadingBandScrollBounds {
	scrollTop: number;
	maxScrollTop: number;
}

export interface ReadingBandGeometry extends ReadingBandScrollBounds {
	viewportHeight: number;
	edgeBottom: number | null;
	runwayBottom?: number | null;
}

export interface ReadingBandSnapshot {
	following: boolean;
	moving: boolean;
	runway: boolean;
	buttonLabel: "Follow response" | "Latest" | null;
}

export interface ReadingBandEnvironment {
	readGeometry: () => ReadingBandGeometry | null;
	readScrollBounds: () => ReadingBandScrollBounds | null;
	readViewportHeight: () => number;
	writeScrollTop: (top: number) => void;
	writeRunwayHeight: (height: number) => void;
	anchorTurn: (index: number, inset: number) => void;
	prefersReducedMotion: () => boolean;
	now: () => number;
	requestFrame: (callback: (time: number) => void) => number;
	cancelFrame: (id: number) => void;
	onStateChange: (state: ReadingBandSnapshot) => void;
}

export interface ReadingBandController {
	getSnapshot: () => ReadingBandSnapshot;
	armImmediateTurn: () => void;
	cancelImmediateTurn: (streaming: boolean) => void;
	userTurnArrived: (index: number, source: "immediate" | "queued") => void;
	latestRowArrived: (index: number) => void;
	contentChanged: () => void;
	cancelMovement: () => void;
	cancelReveal: () => void;
	revealTo: (target: () => number | null, stabilize: boolean) => void;
	readerLeft: () => void;
	readerMovedWhileFollowing: () => void;
	readerReachedEdge: () => void;
	returnToEdge: () => void;
	releaseRunway: (smooth?: boolean) => void;
	settle: () => void;
	setStreaming: (streaming: boolean) => void;
	setMovement: (movement: ReadingBandMovement) => void;
	reconstructActiveStream: () => void;
	setLatestEdge: (edge: ReadingBandLatestEdge) => void;
	dispose: () => void;
}

interface ReadingBandState {
	following: boolean;
	moving: boolean;
	runway: boolean;
	streaming: boolean;
}

type ScrollTarget = () => number | null;

interface ActiveMotion {
	kind: "alignment" | "reveal" | "runway" | "settlement";
	scrollTarget: ScrollTarget | null;
	runwayTarget: number | null;
	retainActiveRunway: boolean;
	requireFollowing: boolean;
	requireStreaming: boolean;
	reevaluate: boolean;
	startedAt: number;
	startScrollTop: number;
	startRunwayHeight: number;
	stabilityFrames: number;
	stabilizing: boolean;
	instant: boolean;
}

function snapshotOf(state: ReadingBandState): ReadingBandSnapshot {
	return {
		following: state.following,
		moving: state.moving,
		runway: state.runway,
		buttonLabel: state.following ? null : state.streaming ? "Follow response" : "Latest",
	};
}

export function initialReadingBandSnapshot(streaming: boolean): ReadingBandSnapshot {
	return snapshotOf({ following: true, moving: false, runway: streaming, streaming });
}

function turnInset(viewportHeight: number): number {
	return Math.min(TURN_INSET_MAX, Math.max(TURN_INSET_MIN, viewportHeight * TURN_INSET_RATIO));
}

function easeOutCubic(progress: number): number {
	return 1 - (1 - progress) ** 3;
}

export function headerHeightScrollTarget(
	previousScrollTop: number,
	previousHeight: number,
	nextHeight: number,
	bounds: ReadingBandScrollBounds,
	latestEdge: ReadingBandLatestEdge,
	following: boolean,
): number {
	if (latestEdge !== "top" || following) return bounds.scrollTop;
	return Math.min(
		bounds.maxScrollTop,
		Math.max(0, previousScrollTop + nextHeight - previousHeight),
	);
}

export function markerBottomWithoutHeader(
	markerBottom: number,
	viewportTop: number,
	headerHeight: number,
): number {
	return markerBottom - viewportTop - headerHeight;
}

function runwayBottom(geometry: ReadingBandGeometry): number | null {
	return geometry.runwayBottom === undefined ? geometry.edgeBottom : geometry.runwayBottom;
}

export function createReadingBandController(
	environment: ReadingBandEnvironment,
	{
		streaming,
		latestEdge = "bottom",
		movement: initialMovement,
	}: {
		streaming: boolean;
		latestEdge?: ReadingBandLatestEdge;
		movement: ReadingBandMovement;
	},
): ReadingBandController {
	let movement = initialMovement;
	let state: ReadingBandState = {
		following: true,
		moving: false,
		runway: streaming,
		streaming,
	};
	let frame: number | null = null;
	let motion: ActiveMotion | null = null;
	let anchorFrame: number | null = null;
	let activeStreamMount = streaming;
	let reconstructed = false;
	let runwayHeight = 0;
	let runwayStartEdge: number | null = null;
	let runwayStartHeight = 0;
	let immediateTurnPending = false;
	let pendingSettleReturn = false;
	let deferredUserTurn: { index: number; source: "immediate" | "queued" } | null = null;
	let deferredLatestRow: number | null = null;
	let runwaySuppressed = false;

	const publish = (patch: Partial<ReadingBandState>) => {
		const next = { ...state, ...patch };
		if (
			next.following === state.following &&
			next.moving === state.moving &&
			next.runway === state.runway &&
			next.streaming === state.streaming
		) {
			return;
		}
		state = next;
		environment.onStateChange(snapshotOf(state));
	};

	const resetRunwayTracking = () => {
		runwayStartEdge = null;
		runwayStartHeight = 0;
	};

	const writeRunwayHeight = (height: number) => {
		const pixels = Math.max(0, Math.round(height));
		if (Math.abs(runwayHeight - pixels) <= GEOMETRY_EPSILON) return;
		runwayHeight = pixels;
		environment.writeRunwayHeight(pixels);
		if (pixels === 0) resetRunwayTracking();
	};

	const cancelAnchor = () => {
		if (anchorFrame !== null) environment.cancelFrame(anchorFrame);
		anchorFrame = null;
	};

	const completeMotion = (reevaluate: boolean) => {
		const completed = motion;
		motion = null;
		frame = null;
		if (completed?.runwayTarget === 0) {
			writeRunwayHeight(0);
			publish({
				runway: completed.retainActiveRunway && state.streaming && state.following,
			});
		}
		if (state.moving) publish({ moving: false });
		const appliedDeferredRow = completed?.kind === "settlement" && flushDeferredRows();
		if (reevaluate && !appliedDeferredRow) contentChanged();
	};

	const cancelMotion = () => {
		if (frame !== null) environment.cancelFrame(frame);
		frame = null;
		motion = null;
		if (state.moving) publish({ moving: false });
	};

	const boundedScrollTarget = (target: ScrollTarget | null): number | null => {
		if (!target) return null;
		const bounds = environment.readScrollBounds();
		const value = target();
		if (!bounds || value === null) return null;
		return Math.min(bounds.maxScrollTop, Math.max(0, value));
	};

	const motionSettled = (active: ActiveMotion): boolean => {
		const bounds = environment.readScrollBounds();
		const target = boundedScrollTarget(active.scrollTarget);
		const scrollSettled =
			target === null || !bounds || Math.abs(target - bounds.scrollTop) <= GEOMETRY_EPSILON;
		const runwaySettled =
			active.runwayTarget === null ||
			Math.abs(active.runwayTarget - runwayHeight) <= GEOMETRY_EPSILON;
		return scrollSettled && runwaySettled;
	};

	const applyInstantMotion = (active: ActiveMotion) => {
		const target = boundedScrollTarget(active.scrollTarget);
		if (target !== null) environment.writeScrollTop(target);
		if (active.runwayTarget !== null) writeRunwayHeight(active.runwayTarget);
		if (active.runwayTarget === 0) {
			publish({
				runway: active.retainActiveRunway && state.streaming && state.following,
			});
		}
	};

	const advanceMotion = (time: number) => {
		frame = null;
		const active = motion;
		if (!active) return;
		if (
			(active.requireFollowing && !state.following) ||
			(active.requireStreaming && !state.streaming)
		) {
			completeMotion(false);
			return;
		}
		if (active.stabilizing) {
			if (!motionSettled(active)) {
				if (active.instant) {
					applyInstantMotion(active);
				} else {
					const bounds = environment.readScrollBounds();
					active.startScrollTop = bounds?.scrollTop ?? active.startScrollTop;
					active.startRunwayHeight = runwayHeight;
					active.startedAt = time;
					active.stabilizing = false;
					frame = environment.requestFrame(advanceMotion);
					return;
				}
			}
			active.stabilityFrames -= 1;
			if (active.stabilityFrames <= 0) {
				completeMotion(active.reevaluate);
				return;
			}
			frame = environment.requestFrame(advanceMotion);
			return;
		}
		const progress = Math.min(1, Math.max(0, (time - active.startedAt) / ADVANCE_DURATION_MS));
		const eased = easeOutCubic(progress);
		const target = boundedScrollTarget(active.scrollTarget);
		if (target !== null) {
			environment.writeScrollTop(active.startScrollTop + (target - active.startScrollTop) * eased);
		}
		if (active.runwayTarget !== null) {
			writeRunwayHeight(
				active.startRunwayHeight + (active.runwayTarget - active.startRunwayHeight) * eased,
			);
			if (active.runwayTarget === 0 && runwayHeight <= GEOMETRY_EPSILON) {
				active.runwayTarget = null;
				publish({
					runway: active.retainActiveRunway && state.streaming && state.following,
				});
			}
		}
		if (progress < 1) {
			frame = environment.requestFrame(advanceMotion);
			return;
		}
		if (!motionSettled(active)) {
			const bounds = environment.readScrollBounds();
			active.startScrollTop = bounds?.scrollTop ?? active.startScrollTop;
			active.startRunwayHeight = runwayHeight;
			active.startedAt = time;
			frame = environment.requestFrame(advanceMotion);
			return;
		}
		if (active.stabilityFrames > 0) {
			active.stabilizing = true;
			frame = environment.requestFrame(advanceMotion);
			return;
		}
		completeMotion(active.reevaluate);
	};

	const startMotion = ({
		kind = "alignment",
		scrollTarget = null,
		runwayTarget = null,
		retainActiveRunway = false,
		requireFollowing = true,
		requireStreaming = false,
		reevaluate = false,
		stabilityFrames = 0,
	}: {
		kind?: ActiveMotion["kind"];
		scrollTarget?: ScrollTarget | null;
		runwayTarget?: number | null;
		retainActiveRunway?: boolean;
		requireFollowing?: boolean;
		requireStreaming?: boolean;
		reevaluate?: boolean;
		stabilityFrames?: number;
	}) => {
		const bounds = environment.readScrollBounds();
		const initialScrollTarget = boundedScrollTarget(scrollTarget);
		const scrollAlreadySettled =
			initialScrollTarget === null ||
			!bounds ||
			Math.abs(initialScrollTarget - bounds.scrollTop) <= GEOMETRY_EPSILON;
		const runwayAlreadySettled =
			runwayTarget === null || Math.abs(runwayTarget - runwayHeight) <= GEOMETRY_EPSILON;
		if (scrollAlreadySettled && runwayAlreadySettled && stabilityFrames === 0) {
			if (runwayTarget === 0) {
				publish({ runway: retainActiveRunway && state.streaming && state.following });
			}
			if (reevaluate) contentChanged();
			return;
		}
		if (environment.prefersReducedMotion()) {
			cancelMotion();
			const target = boundedScrollTarget(scrollTarget);
			if (target !== null) environment.writeScrollTop(target);
			if (runwayTarget !== null) writeRunwayHeight(runwayTarget);
			if (runwayTarget === 0) {
				publish({ runway: retainActiveRunway && state.streaming && state.following });
			}
			if (stabilityFrames > 0) {
				const currentBounds = environment.readScrollBounds();
				motion = {
					kind,
					scrollTarget,
					runwayTarget,
					retainActiveRunway,
					requireFollowing,
					requireStreaming,
					reevaluate,
					startedAt: environment.now(),
					startScrollTop: currentBounds?.scrollTop ?? 0,
					startRunwayHeight: runwayHeight,
					stabilityFrames,
					stabilizing: true,
					instant: true,
				};
				publish({ moving: true });
				frame = environment.requestFrame(advanceMotion);
			} else if (reevaluate) {
				contentChanged();
			}
			return;
		}
		motion = {
			kind,
			scrollTarget,
			runwayTarget,
			retainActiveRunway,
			requireFollowing,
			requireStreaming,
			reevaluate,
			startedAt: environment.now(),
			startScrollTop: bounds?.scrollTop ?? 0,
			startRunwayHeight: runwayHeight,
			stabilityFrames,
			stabilizing: false,
			instant: false,
		};
		publish({ moving: true });
		frame ??= environment.requestFrame(advanceMotion);
	};

	const releaseRunway = (smooth = true) => {
		pendingSettleReturn = false;
		runwaySuppressed = true;
		if (!smooth || runwayHeight <= GEOMETRY_EPSILON || environment.prefersReducedMotion()) {
			cancelMotion();
			writeRunwayHeight(0);
			publish({ runway: false });
			return;
		}
		startMotion({
			kind: "runway",
			runwayTarget: 0,
			requireFollowing: false,
		});
	};

	const reconcileRunwayGrowth = (geometry: ReadingBandGeometry) => {
		if (runwayStartHeight <= 0 || (motion && motion.runwayTarget !== null)) return;
		const bottom = runwayBottom(geometry);
		if (bottom === null) return;
		if (runwayStartEdge === null) {
			runwayStartEdge = geometry.scrollTop + bottom;
			return;
		}
		const growth = Math.max(0, geometry.scrollTop + bottom - runwayStartEdge);
		writeRunwayHeight(Math.max(0, runwayStartHeight - growth));
	};

	const latestScrollTop = (bounds: ReadingBandScrollBounds) =>
		latestEdge === "top" ? 0 : bounds.maxScrollTop;

	const latestTarget: ScrollTarget = () => {
		const bounds = environment.readScrollBounds();
		return bounds ? latestScrollTop(bounds) : null;
	};

	const addRunwayForTarget = (geometry: ReadingBandGeometry, target: number) => {
		const naturalMaxScrollTop = Math.max(0, geometry.maxScrollTop - runwayHeight);
		const required = Math.max(0, target - naturalMaxScrollTop);
		const bottom = runwayBottom(geometry);
		runwayStartEdge = bottom === null ? null : geometry.scrollTop + bottom;
		runwayStartHeight = required;
		writeRunwayHeight(required);
		publish({ runway: true });
	};

	const settleTarget = (geometry: ReadingBandGeometry): number | null => {
		if (geometry.edgeBottom === null) return null;
		return Math.max(
			0,
			geometry.scrollTop + geometry.edgeBottom - geometry.viewportHeight * (movement.settle / 100),
		);
	};

	const liveSettleTarget: ScrollTarget = () => {
		const geometry = environment.readGeometry();
		return geometry ? settleTarget(geometry) : null;
	};

	const moveEdgeToSettle = (geometry: ReadingBandGeometry, animate: boolean) => {
		const target = settleTarget(geometry);
		if (target === null) return false;
		addRunwayForTarget(geometry, target);
		if (animate) {
			startMotion({ scrollTarget: liveSettleTarget, requireStreaming: true, reevaluate: true });
		} else {
			const refreshedTarget = boundedScrollTarget(liveSettleTarget);
			if (refreshedTarget !== null) environment.writeScrollTop(refreshedTarget);
		}
		return true;
	};

	const settle = () => {
		cancelAnchor();
		immediateTurnPending = false;
		pendingSettleReturn = false;
		deferredUserTurn = null;
		deferredLatestRow = null;
		runwaySuppressed = true;
		publish({ following: true, streaming: false });
		startMotion({
			kind: "settlement",
			scrollTarget: latestTarget,
			runwayTarget: 0,
			retainActiveRunway: true,
			reevaluate: true,
			stabilityFrames: EDGE_STABILITY_FRAMES,
		});
	};

	function contentChanged() {
		let geometry = environment.readGeometry();
		if (!geometry || geometry.viewportHeight <= 0) return;
		reconcileRunwayGrowth(geometry);
		if (immediateTurnPending || !state.following) return;
		if (state.moving) {
			if (motion?.instant) applyInstantMotion(motion);
			return;
		}
		if (!state.streaming) {
			startMotion({ scrollTarget: latestTarget });
			return;
		}
		if (runwaySuppressed) return;
		geometry = environment.readGeometry() ?? geometry;
		if (pendingSettleReturn) {
			pendingSettleReturn = !moveEdgeToSettle(geometry, true);
			return;
		}
		const bottom = geometry.edgeBottom;
		if (bottom === null) return;
		const trigger = geometry.viewportHeight * (movement.trigger / 100);
		if (bottom <= trigger + GEOMETRY_EPSILON) return;
		moveEdgeToSettle(geometry, true);
	}

	function applyUserTurn(index: number, source: "immediate" | "queued") {
		if (source === "queued" && !state.following) return;
		cancelMotion();
		if (source === "immediate") publish({ following: true, runway: true });
		const viewportHeight = environment.readViewportHeight();
		if (viewportHeight <= 0) return;
		const inset = turnInset(viewportHeight);
		cancelAnchor();
		anchorFrame = environment.requestFrame(() => {
			anchorFrame = null;
			if (state.following) environment.anchorTurn(index, inset);
		});
	}

	function applyLatestRow(index: number) {
		if (latestEdge !== "top" || index !== 0 || !state.following) return;
		startMotion({ scrollTarget: latestTarget });
	}

	function flushDeferredRows(): boolean {
		const userTurn = deferredUserTurn;
		const latestRow = deferredLatestRow;
		deferredUserTurn = null;
		deferredLatestRow = null;
		if (userTurn) {
			applyUserTurn(userTurn.index, userTurn.source);
			return true;
		}
		if (latestRow !== null) {
			applyLatestRow(latestRow);
			return true;
		}
		return false;
	}

	const yieldMotionToReader = () => {
		cancelAnchor();
		immediateTurnPending = false;
		deferredUserTurn = null;
		deferredLatestRow = null;
		if (motion?.instant) {
			cancelMotion();
		} else if (motion?.runwayTarget === 0) {
			if (motion.scrollTarget !== null || motion.requireFollowing || motion.stabilizing) {
				const bounds = environment.readScrollBounds();
				motion.kind = "runway";
				motion.scrollTarget = null;
				motion.retainActiveRunway = false;
				motion.requireFollowing = false;
				motion.requireStreaming = false;
				motion.reevaluate = false;
				motion.startScrollTop = bounds?.scrollTop ?? motion.startScrollTop;
				motion.startRunwayHeight = runwayHeight;
				motion.startedAt = environment.now();
				motion.stabilityFrames = 0;
				motion.stabilizing = false;
			}
		} else {
			cancelMotion();
		}
		if (runwayHeight > GEOMETRY_EPSILON) {
			if (motion?.runwayTarget !== 0) releaseRunway(true);
		} else {
			publish({ runway: false });
		}
	};

	return {
		getSnapshot: () => snapshotOf(state),
		armImmediateTurn: () => {
			cancelMotion();
			cancelAnchor();
			immediateTurnPending = true;
			pendingSettleReturn = false;
			deferredUserTurn = null;
			deferredLatestRow = null;
			runwaySuppressed = false;
			writeRunwayHeight(0);
			publish({ following: true, runway: true });
		},
		cancelImmediateTurn: (streaming) => {
			immediateTurnPending = false;
			cancelAnchor();
			if (!streaming) {
				settle();
				return;
			}
			runwaySuppressed = false;
			publish({ streaming: true, runway: state.following });
			contentChanged();
		},
		userTurnArrived: (index, source) => {
			if (motion?.kind === "settlement") {
				deferredUserTurn = { index, source };
				return;
			}
			applyUserTurn(index, source);
		},
		latestRowArrived: (index) => {
			if (motion?.kind === "settlement") {
				deferredLatestRow = index;
				return;
			}
			applyLatestRow(index);
		},
		contentChanged,
		cancelMovement: () => {
			cancelMotion();
			cancelAnchor();
		},
		cancelReveal: () => {
			if (motion?.kind === "reveal") cancelMotion();
		},
		revealTo: (target, stabilize) => {
			cancelAnchor();
			startMotion({
				kind: "reveal",
				scrollTarget: target,
				runwayTarget: runwayHeight > GEOMETRY_EPSILON ? 0 : null,
				requireFollowing: false,
				stabilityFrames: stabilize ? EDGE_STABILITY_FRAMES : 0,
			});
		},
		readerLeft: () => {
			yieldMotionToReader();
			publish({ following: false });
		},
		readerMovedWhileFollowing: yieldMotionToReader,
		readerReachedEdge: () => {
			cancelMotion();
			runwaySuppressed = false;
			publish({ following: true, runway: state.streaming });
			if (!state.streaming) {
				startMotion({
					scrollTarget: latestTarget,
					stabilityFrames: EDGE_STABILITY_FRAMES,
				});
				return;
			}
			const geometry = environment.readGeometry();
			if (!geometry || !moveEdgeToSettle(geometry, true)) pendingSettleReturn = true;
		},
		returnToEdge: () => {
			cancelMotion();
			cancelAnchor();
			immediateTurnPending = false;
			runwaySuppressed = false;
			publish({ following: true, runway: state.streaming });
			if (!state.streaming) {
				startMotion({
					scrollTarget: latestTarget,
					stabilityFrames: EDGE_STABILITY_FRAMES,
				});
				return;
			}
			const geometry = environment.readGeometry();
			if (!geometry || !moveEdgeToSettle(geometry, true)) pendingSettleReturn = true;
		},
		releaseRunway,
		settle,
		setStreaming: (nextStreaming) => {
			if (!nextStreaming) {
				settle();
				return;
			}
			immediateTurnPending = false;
			runwaySuppressed = false;
			publish({ streaming: true, runway: state.following });
		},
		setMovement: (nextMovement) => {
			movement = nextMovement;
			contentChanged();
		},
		reconstructActiveStream: () => {
			if (!activeStreamMount || !state.streaming || reconstructed) return;
			const geometry = environment.readGeometry();
			if (!geometry) return;
			reconstructed = true;
			cancelMotion();
			runwaySuppressed = false;
			publish({ runway: true });
			if (!moveEdgeToSettle(geometry, false)) pendingSettleReturn = true;
		},
		setLatestEdge: (edge) => {
			if (edge === latestEdge) return;
			cancelMotion();
			cancelAnchor();
			latestEdge = edge;
			immediateTurnPending = false;
			deferredUserTurn = null;
			deferredLatestRow = null;
			activeStreamMount = state.streaming;
			reconstructed = false;
			pendingSettleReturn = false;
			runwaySuppressed = false;
			writeRunwayHeight(0);
			publish({ following: true, runway: state.streaming });
		},
		dispose: () => {
			cancelMotion();
			cancelAnchor();
			immediateTurnPending = false;
			pendingSettleReturn = false;
			deferredUserTurn = null;
			deferredLatestRow = null;
		},
	};
}
