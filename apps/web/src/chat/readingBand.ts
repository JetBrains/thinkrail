const TURN_INSET_RATIO = 0.1;
const TURN_INSET_MIN = 48;
const TURN_INSET_MAX = 80;
const ADVANCE_DURATION_MS = 220;
const FOLLOW_TIME_CONSTANT_MS = 90;
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
	interruptForNativeInput: (pauseState?: "stationary" | "pending") => () => void;
	cancelReveal: () => void;
	revealTo: (target: () => number | null, stabilize: boolean) => void;
	stabilizeAnchor: (target: () => number | null) => void;
	refreshAnchor: () => void;
	readerLeft: () => void;
	readerReachedEdge: () => void;
	returnToEdge: () => void;
	releaseRunway: () => void;
	reconcileRoom: () => void;
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
	kind: "alignment" | "anchor" | "reveal" | "settlement" | "follow";
	scrollTarget: ScrollTarget | null;
	runwayTarget: number | null;
	requireFollowing: boolean;
	requireStreaming: boolean;
	reevaluate: boolean;
	startedAt: number;
	startScrollTop: number;
	startRunwayHeight: number;
	stabilityFrames: number;
	stabilizing: boolean;
	instant: boolean;
	instantScroll: boolean;
	smoothing: boolean;
	deriveRoom: (() => number | null) | null;
	lastFrameTime: number;
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
	let motionEpoch = 0;
	let anchorFrame: number | null = null;
	let activeStreamMount = streaming;
	let reconstructed = false;
	let runwayHeight = 0;
	let holding = false;
	let immediateTurnPending = false;
	let pendingSettleReturn = false;
	let deferredUserTurn: { index: number; source: "immediate" | "queued" } | null = null;
	let deferredLatestRow: number | null = null;
	let runwaySuppressed = false;
	let nativeInputPending = false;
	let settlementAfterInput = false;
	let nativeInputToken = 0;

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

	const writeRunwayHeight = (height: number) => {
		const pixels = Math.max(0, Math.round(height));
		if (Math.abs(runwayHeight - pixels) <= GEOMETRY_EPSILON) return;
		runwayHeight = pixels;
		environment.writeRunwayHeight(pixels);
	};

	const cancelAnchor = () => {
		if (anchorFrame !== null) environment.cancelFrame(anchorFrame);
		anchorFrame = null;
	};

	const runwayNeeded = () =>
		runwayHeight > GEOMETRY_EPSILON ||
		(state.following && (immediateTurnPending || (state.streaming && !runwaySuppressed)));

	const publishRunway = () => publish({ runway: runwayNeeded() });

	const syncDerivedRoom = (active: ActiveMotion) => {
		if (!active.deriveRoom) return;
		const value = active.deriveRoom();
		if (value === null) return;
		writeRunwayHeight(value);
		publishRunway();
	};

	const completeMotion = (reevaluate: boolean) => {
		const completed = motion;
		motion = null;
		frame = null;
		if (completed?.runwayTarget === 0) {
			writeRunwayHeight(0);
			publishRunway();
		}
		if (state.moving) publish({ moving: false });
		const appliedDeferredRow = completed?.kind === "settlement" && flushDeferredRows();
		if (reevaluate && !appliedDeferredRow) contentChanged();
	};

	const cancelMotion = () => {
		motionEpoch += 1;
		if (frame !== null) environment.cancelFrame(frame);
		frame = null;
		motion = null;
		if (state.moving) publish({ moving: false });
	};

	const boundedScrollTarget = (target: ScrollTarget | null): number | null => {
		if (!target) return null;
		const value = target();
		const bounds = environment.readScrollBounds();
		if (!bounds || value === null) return null;
		return Math.min(bounds.maxScrollTop, Math.max(0, value));
	};

	const motionSettled = (active: ActiveMotion): boolean => {
		syncDerivedRoom(active);
		const target = boundedScrollTarget(active.scrollTarget);
		const bounds = environment.readScrollBounds();
		const scrollSettled =
			target === null || !bounds || Math.abs(target - bounds.scrollTop) <= GEOMETRY_EPSILON;
		const runwaySettled =
			active.runwayTarget === null ||
			Math.abs(active.runwayTarget - runwayHeight) <= GEOMETRY_EPSILON;
		return scrollSettled && runwaySettled;
	};

	const applyInstantMotion = (active: ActiveMotion) => {
		syncDerivedRoom(active);
		const target = boundedScrollTarget(active.scrollTarget);
		if (target !== null) environment.writeScrollTop(target);
		if (active.runwayTarget !== null) writeRunwayHeight(active.runwayTarget);
		if (active.runwayTarget !== null) publishRunway();
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
		syncDerivedRoom(active);
		if (active.stabilizing) {
			if (!motionSettled(active)) {
				if (active.instant) {
					applyInstantMotion(active);
				} else {
					if (active.instantScroll) {
						const target = boundedScrollTarget(active.scrollTarget);
						if (target !== null) environment.writeScrollTop(target);
					}
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
		if (active.smoothing) {
			const dt = Math.max(0, time - active.lastFrameTime);
			const alpha = 1 - Math.exp(-dt / FOLLOW_TIME_CONSTANT_MS);
			const target = boundedScrollTarget(active.scrollTarget);
			if (target === null) {
				frame = environment.requestFrame(advanceMotion);
				return;
			}
			const bounds = environment.readScrollBounds();
			if (!bounds) {
				frame = environment.requestFrame(advanceMotion);
				return;
			}
			let next = bounds.scrollTop + (target - bounds.scrollTop) * alpha;
			if (Math.abs(target - next) <= GEOMETRY_EPSILON) next = target;
			environment.writeScrollTop(next);
			active.lastFrameTime = time;
			if (motionSettled(active)) {
				completeMotion(active.reevaluate);
			} else {
				frame = environment.requestFrame(advanceMotion);
			}
			return;
		}
		const progress = Math.min(1, Math.max(0, (time - active.startedAt) / ADVANCE_DURATION_MS));
		const eased = easeOutCubic(progress);
		const target = boundedScrollTarget(active.scrollTarget);
		if (target !== null) {
			environment.writeScrollTop(
				active.instantScroll
					? target
					: active.startScrollTop + (target - active.startScrollTop) * eased,
			);
		}
		if (active.runwayTarget !== null) {
			writeRunwayHeight(
				active.startRunwayHeight + (active.runwayTarget - active.startRunwayHeight) * eased,
			);
			if (active.runwayTarget === 0 && runwayHeight <= GEOMETRY_EPSILON) {
				active.runwayTarget = null;
				publishRunway();
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
		requireFollowing = true,
		requireStreaming = false,
		reevaluate = false,
		stabilityFrames = 0,
		instant = false,
		instantScroll = false,
		smoothing = false,
		deriveRoom = null,
	}: {
		kind?: ActiveMotion["kind"];
		scrollTarget?: ScrollTarget | null;
		runwayTarget?: number | null;
		requireFollowing?: boolean;
		requireStreaming?: boolean;
		reevaluate?: boolean;
		stabilityFrames?: number;
		instant?: boolean;
		instantScroll?: boolean;
		smoothing?: boolean;
		deriveRoom?: (() => number | null) | null;
	}) => {
		motionEpoch += 1;
		const startedAt = environment.now();
		const active: ActiveMotion = {
			kind,
			scrollTarget,
			runwayTarget,
			requireFollowing,
			requireStreaming,
			reevaluate,
			startedAt,
			startScrollTop: 0,
			startRunwayHeight: runwayHeight,
			stabilityFrames,
			stabilizing: false,
			instant: instant || environment.prefersReducedMotion(),
			instantScroll,
			smoothing,
			deriveRoom,
			lastFrameTime: startedAt,
		};
		syncDerivedRoom(active);
		const bounds = environment.readScrollBounds();
		const initialScrollTarget = boundedScrollTarget(scrollTarget);
		const scrollAlreadySettled =
			initialScrollTarget === null ||
			!bounds ||
			Math.abs(initialScrollTarget - bounds.scrollTop) <= GEOMETRY_EPSILON;
		const runwayAlreadySettled =
			runwayTarget === null || Math.abs(runwayTarget - runwayHeight) <= GEOMETRY_EPSILON;
		if (scrollAlreadySettled && runwayAlreadySettled && stabilityFrames === 0) {
			if (runwayTarget !== null) publishRunway();
			if (reevaluate) contentChanged();
			return;
		}
		if (active.instant) {
			cancelMotion();
			syncDerivedRoom(active);
			const target = boundedScrollTarget(scrollTarget);
			if (target !== null) environment.writeScrollTop(target);
			if (runwayTarget !== null) writeRunwayHeight(runwayTarget);
			if (runwayTarget !== null) publishRunway();
			if (stabilityFrames > 0) {
				const currentBounds = environment.readScrollBounds();
				active.startScrollTop = currentBounds?.scrollTop ?? 0;
				active.startRunwayHeight = runwayHeight;
				active.startedAt = environment.now();
				active.lastFrameTime = active.startedAt;
				active.stabilizing = true;
				motion = active;
				publish({ moving: true });
				frame = environment.requestFrame(advanceMotion);
			} else if (reevaluate) {
				contentChanged();
			}
			return;
		}
		active.startScrollTop = bounds?.scrollTop ?? 0;
		active.startRunwayHeight = runwayHeight;
		motion = active;
		publish({ moving: true });
		frame ??= environment.requestFrame(advanceMotion);
	};

	const releaseRunway = () => {
		pendingSettleReturn = false;
		runwaySuppressed = true;
		holding = false;
		cancelMotion();
		writeRunwayHeight(0);
		publish({ runway: false });
	};

	const latestScrollTop = (bounds: ReadingBandScrollBounds) =>
		latestEdge === "top" ? 0 : bounds.maxScrollTop;

	const latestTarget: ScrollTarget = () => {
		const bounds = environment.readScrollBounds();
		return bounds ? latestScrollTop(bounds) : null;
	};

	const settleTarget = (geometry: ReadingBandGeometry): number | null => {
		if (geometry.edgeBottom === null) return null;
		return Math.max(
			0,
			geometry.scrollTop + geometry.edgeBottom - geometry.viewportHeight * (movement.settle / 100),
		);
	};

	const naturalMaxScrollTop = (geometry: ReadingBandGeometry) =>
		Math.max(0, geometry.maxScrollTop - runwayHeight);

	const liveSettleTarget: ScrollTarget = () => {
		const geometry = environment.readGeometry();
		return geometry ? settleTarget(geometry) : null;
	};

	const holdRoom = () => {
		const geometry = environment.readGeometry();
		if (!geometry) return null;
		const target = settleTarget(geometry);
		return target === null ? null : Math.max(0, target - naturalMaxScrollTop(geometry));
	};

	const reconcileReaderRoom = (geometry?: ReadingBandGeometry | null) => {
		const current = geometry ?? environment.readGeometry();
		if (!current) return;
		const keep = Math.max(0, current.scrollTop - naturalMaxScrollTop(current));
		if (keep < runwayHeight - GEOMETRY_EPSILON) writeRunwayHeight(keep);
		publishRunway();
	};

	const startHold = (geometry: ReadingBandGeometry, animate: boolean) => {
		if (settleTarget(geometry) === null) return false;
		holding = true;
		if (animate) {
			startMotion({
				kind: "follow",
				scrollTarget: liveSettleTarget,
				deriveRoom: holdRoom,
				smoothing: true,
				requireStreaming: true,
				requireFollowing: true,
				reevaluate: false,
			});
		} else {
			const room = holdRoom();
			if (room !== null) writeRunwayHeight(room);
			publishRunway();
			const target = boundedScrollTarget(liveSettleTarget);
			if (target !== null) environment.writeScrollTop(target);
		}
		return true;
	};

	const refreshAnchor = () => {
		if (motion?.kind !== "anchor") return;
		const target = boundedScrollTarget(motion.scrollTarget);
		if (target !== null) environment.writeScrollTop(target);
	};

	const startSettlementReturn = () =>
		startMotion({
			kind: "settlement",
			scrollTarget: latestTarget,
			runwayTarget: 0,
			reevaluate: true,
			stabilityFrames: EDGE_STABILITY_FRAMES,
		});

	const settle = () => {
		cancelAnchor();
		immediateTurnPending = false;
		pendingSettleReturn = false;
		deferredUserTurn = null;
		deferredLatestRow = null;
		runwaySuppressed = true;
		holding = false;
		if (state.following) {
			publish({ streaming: false, runway: runwayHeight > GEOMETRY_EPSILON });
			if (nativeInputPending) {
				settlementAfterInput = true;
				return;
			}
			startSettlementReturn();
			return;
		}
		cancelMotion();
		publish({ streaming: false, runway: runwayHeight > GEOMETRY_EPSILON });
		reconcileReaderRoom();
	};

	function contentChanged() {
		refreshAnchor();
		const geometry = environment.readGeometry();
		if (!geometry || geometry.viewportHeight <= 0) return;
		if (!(holding && state.following && state.streaming)) reconcileReaderRoom(geometry);
		if (nativeInputPending || immediateTurnPending || !state.following) return;
		if (state.moving) {
			if (motion?.instant) applyInstantMotion(motion);
			else if (motion) syncDerivedRoom(motion);
			return;
		}
		if (!state.streaming) {
			startMotion({ scrollTarget: latestTarget });
			return;
		}
		if (runwaySuppressed) return;
		if (pendingSettleReturn) {
			pendingSettleReturn = !startHold(geometry, true);
			return;
		}
		if (!holding) {
			const bottom = geometry.edgeBottom;
			if (bottom === null) return;
			const trigger = geometry.viewportHeight * (movement.trigger / 100);
			if (bottom <= trigger + GEOMETRY_EPSILON) return;
		}
		startHold(geometry, true);
	}

	function userTurnApplies(source: "immediate" | "queued") {
		return source === "immediate" || state.following;
	}

	function latestRowApplies(index: number) {
		return latestEdge === "top" && index === 0 && state.following;
	}

	function applyUserTurn(index: number, source: "immediate" | "queued"): boolean {
		if (!userTurnApplies(source)) return false;
		holding = false;
		runwaySuppressed = false;
		cancelMotion();
		if (source === "immediate") publish({ following: true });
		publishRunway();
		const viewportHeight = environment.readViewportHeight();
		if (viewportHeight <= 0) return true;
		const inset = turnInset(viewportHeight);
		cancelAnchor();
		anchorFrame = environment.requestFrame(() => {
			anchorFrame = null;
			if (state.following) environment.anchorTurn(index, inset);
		});
		return true;
	}

	function applyLatestRow(index: number): boolean {
		if (!latestRowApplies(index)) return false;
		startMotion({ scrollTarget: latestTarget });
		return true;
	}

	function flushDeferredRows(): boolean {
		const userTurn = deferredUserTurn;
		const latestRow = deferredLatestRow;
		deferredUserTurn = null;
		deferredLatestRow = null;
		if (userTurn && applyUserTurn(userTurn.index, userTurn.source)) return true;
		return latestRow !== null && applyLatestRow(latestRow);
	}

	const releaseNativeInput = () => {
		nativeInputPending = false;
		settlementAfterInput = false;
		nativeInputToken += 1;
	};

	const interruptForNativeInput = (pauseState: "stationary" | "pending" = "stationary") => {
		nativeInputToken += 1;
		const token = nativeInputToken;
		nativeInputPending = true;
		const paused = motion;
		const wasFollowing = state.following;
		const wasStreaming = state.streaming;
		let epoch = motionEpoch;
		if (paused) {
			if (frame !== null) environment.cancelFrame(frame);
			frame = null;
			motion = null;
			epoch = motionEpoch + 1;
			motionEpoch = epoch;
			if (pauseState === "stationary" && state.moving) publish({ moving: false });
		}
		return () => {
			if (token !== nativeInputToken) return;
			nativeInputPending = false;
			if (settlementAfterInput) {
				settlementAfterInput = false;
				if (state.moving && motion === null) publish({ moving: false });
				if (state.following) {
					startSettlementReturn();
					return;
				}
				deferredUserTurn = null;
				deferredLatestRow = null;
				return;
			}
			if (flushDeferredRows()) {
				if (state.moving && motion === null) publish({ moving: false });
				return;
			}
			if (
				!paused ||
				motionEpoch !== epoch ||
				motion !== null ||
				state.following !== wasFollowing ||
				state.streaming !== wasStreaming
			) {
				if (state.moving && motion === null) publish({ moving: false });
				contentChanged();
				return;
			}
			motionEpoch += 1;
			const bounds = environment.readScrollBounds();
			const resumedAt = environment.now();
			motion = {
				...paused,
				startedAt: resumedAt,
				lastFrameTime: resumedAt,
				startScrollTop: bounds?.scrollTop ?? paused.startScrollTop,
				startRunwayHeight: runwayHeight,
			};
			publish({ moving: true });
			frame = environment.requestFrame(advanceMotion);
		};
	};

	const yieldMotionToReader = () => {
		releaseNativeInput();
		cancelAnchor();
		immediateTurnPending = false;
		deferredUserTurn = null;
		deferredLatestRow = null;
		holding = false;
		cancelMotion();
		reconcileReaderRoom();
	};

	return {
		getSnapshot: () => snapshotOf(state),
		armImmediateTurn: () => {
			releaseNativeInput();
			cancelMotion();
			cancelAnchor();
			holding = false;
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
			publish({ streaming: true, runway: runwayHeight > GEOMETRY_EPSILON || state.following });
			contentChanged();
		},
		userTurnArrived: (index, source) => {
			if (motion?.kind === "settlement" || (nativeInputPending && userTurnApplies(source))) {
				deferredUserTurn = { index, source };
				return;
			}
			applyUserTurn(index, source);
		},
		latestRowArrived: (index) => {
			if (motion?.kind === "settlement" || (nativeInputPending && latestRowApplies(index))) {
				deferredLatestRow = index;
				return;
			}
			applyLatestRow(index);
		},
		contentChanged,
		reconcileRoom: () => {
			if (holding && state.following && state.streaming) return;
			reconcileReaderRoom();
		},
		cancelMovement: () => {
			cancelMotion();
			cancelAnchor();
		},
		interruptForNativeInput,
		cancelReveal: () => {
			if (motion?.kind !== "anchor" && motion?.kind !== "reveal") return;
			cancelMotion();
			reconcileReaderRoom();
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
		stabilizeAnchor: (target) => {
			cancelAnchor();
			startMotion({
				kind: "anchor",
				scrollTarget: target,
				runwayTarget: null,
				requireFollowing: false,
				stabilityFrames: EDGE_STABILITY_FRAMES,
				instantScroll: true,
			});
		},
		refreshAnchor,
		readerLeft: () => {
			yieldMotionToReader();
			publish({ following: false, runway: runwayHeight > GEOMETRY_EPSILON });
		},
		readerReachedEdge: () => {
			releaseNativeInput();
			cancelMotion();
			runwaySuppressed = false;
			publish({ following: true, runway: runwayHeight > GEOMETRY_EPSILON || state.streaming });
			if (!state.streaming) {
				startMotion({
					scrollTarget: latestTarget,
					runwayTarget: 0,
					stabilityFrames: EDGE_STABILITY_FRAMES,
				});
				return;
			}
			const geometry = environment.readGeometry();
			pendingSettleReturn = !geometry || !startHold(geometry, true);
		},
		returnToEdge: () => {
			releaseNativeInput();
			cancelMotion();
			cancelAnchor();
			immediateTurnPending = false;
			runwaySuppressed = false;
			publish({ following: true, runway: runwayHeight > GEOMETRY_EPSILON || state.streaming });
			if (!state.streaming) {
				startMotion({
					scrollTarget: latestTarget,
					runwayTarget: 0,
					stabilityFrames: EDGE_STABILITY_FRAMES,
				});
				return;
			}
			const geometry = environment.readGeometry();
			pendingSettleReturn = !geometry || !startHold(geometry, true);
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
			publish({ streaming: true, runway: runwayHeight > GEOMETRY_EPSILON || state.following });
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
			if (!startHold(geometry, false)) pendingSettleReturn = true;
		},
		setLatestEdge: (edge) => {
			if (edge === latestEdge) return;
			releaseNativeInput();
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
			holding = false;
			writeRunwayHeight(0);
			publish({ following: true, runway: runwayHeight > GEOMETRY_EPSILON || state.streaming });
		},
		dispose: () => {
			releaseNativeInput();
			cancelMotion();
			cancelAnchor();
			immediateTurnPending = false;
			pendingSettleReturn = false;
			deferredUserTurn = null;
			deferredLatestRow = null;
		},
	};
}
