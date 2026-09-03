const TURN_INSET_RATIO = 0.1;
const TURN_INSET_MIN = 48;
const TURN_INSET_MAX = 80;
const ADVANCE_DURATION_MS = 220;
const EDGE_PIN_MAX_FRAMES = 30;
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
	userTurnArrived: (index: number, source: "immediate" | "queued") => void;
	latestRowArrived: (index: number) => void;
	contentChanged: () => void;
	cancelMovement: () => void;
	readerLeft: () => void;
	readerReachedEdge: () => void;
	returnToEdge: () => void;
	releaseRunway: (smooth?: boolean) => void;
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
	let runwayFrame: number | null = null;
	let anchorFrame: number | null = null;
	let edgePinFrame: number | null = null;
	let activeStreamMount = streaming;
	let reconstructed = false;
	let runwayHeight = 0;
	let runwayStartEdge: number | null = null;
	let runwayStartHeight = 0;
	let pendingSettleReturn = false;
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

	const cancelMotion = () => {
		if (frame !== null) environment.cancelFrame(frame);
		frame = null;
		if (state.moving) publish({ moving: false });
	};

	const cancelRunwayMotion = () => {
		if (runwayFrame !== null) environment.cancelFrame(runwayFrame);
		runwayFrame = null;
	};

	const cancelAnchor = () => {
		if (anchorFrame !== null) environment.cancelFrame(anchorFrame);
		anchorFrame = null;
	};

	const cancelEdgePin = () => {
		if (edgePinFrame !== null) environment.cancelFrame(edgePinFrame);
		edgePinFrame = null;
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

	const finishRunwayRelease = () => {
		writeRunwayHeight(0);
		resetRunwayTracking();
		publish({ runway: false });
	};

	const releaseRunway = (smooth = true) => {
		pendingSettleReturn = false;
		runwaySuppressed = true;
		cancelRunwayMotion();
		if (!smooth || runwayHeight <= GEOMETRY_EPSILON || environment.prefersReducedMotion()) {
			finishRunwayRelease();
			return;
		}
		const startHeight = runwayHeight;
		const startedAt = environment.now();
		const collapse = (time: number) => {
			const progress = Math.min(1, Math.max(0, (time - startedAt) / ADVANCE_DURATION_MS));
			writeRunwayHeight(startHeight * (1 - easeOutCubic(progress)));
			if (progress < 1) {
				runwayFrame = environment.requestFrame(collapse);
				return;
			}
			runwayFrame = null;
			finishRunwayRelease();
		};
		runwayFrame = environment.requestFrame(collapse);
	};

	const reconcileRunwayGrowth = (geometry: ReadingBandGeometry) => {
		if (runwayStartHeight <= 0 || runwayFrame !== null) return;
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

	const pinLatestEdge = () => {
		cancelEdgePin();
		let remainingFrames = EDGE_PIN_MAX_FRAMES;
		const pin = () => {
			edgePinFrame = null;
			const bounds = environment.readScrollBounds();
			if (!bounds) return;
			environment.writeScrollTop(latestScrollTop(bounds));
			remainingFrames -= 1;
			if (remainingFrames <= 0) return;
			edgePinFrame = environment.requestFrame(pin);
		};
		pin();
	};

	const moveTo = (target: number, requireStreaming: boolean, reevaluate: boolean) => {
		cancelEdgePin();
		const bounds = environment.readScrollBounds();
		if (!bounds) return;
		const boundedTarget = Math.min(bounds.maxScrollTop, Math.max(0, target));
		if (Math.abs(boundedTarget - bounds.scrollTop) <= GEOMETRY_EPSILON) return;
		cancelMotion();
		if (environment.prefersReducedMotion()) {
			environment.writeScrollTop(boundedTarget);
			if (reevaluate) contentChanged();
			return;
		}

		const start = bounds.scrollTop;
		const distance = boundedTarget - start;
		const startedAt = environment.now();
		publish({ moving: true });
		const advance = (time: number) => {
			if (!state.following || (requireStreaming && !state.streaming)) {
				frame = null;
				publish({ moving: false });
				return;
			}
			const progress = Math.min(1, Math.max(0, (time - startedAt) / ADVANCE_DURATION_MS));
			environment.writeScrollTop(start + distance * easeOutCubic(progress));
			if (progress < 1) {
				frame = environment.requestFrame(advance);
				return;
			}
			frame = null;
			publish({ moving: false });
			if (reevaluate) contentChanged();
		};
		frame = environment.requestFrame(advance);
	};

	const addRunwayForTarget = (geometry: ReadingBandGeometry, target: number) => {
		cancelRunwayMotion();
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

	const moveEdgeToSettle = (geometry: ReadingBandGeometry, animate: boolean) => {
		const target = settleTarget(geometry);
		if (target === null) return false;
		addRunwayForTarget(geometry, target);
		const refreshed = environment.readGeometry() ?? geometry;
		const refreshedTarget = settleTarget(refreshed) ?? target;
		if (animate) moveTo(refreshedTarget, true, true);
		else environment.writeScrollTop(refreshedTarget);
		return true;
	};

	function contentChanged() {
		let geometry = environment.readGeometry();
		if (!geometry || geometry.viewportHeight <= 0) return;
		reconcileRunwayGrowth(geometry);
		if (
			!state.streaming ||
			!state.following ||
			state.moving ||
			runwayFrame !== null ||
			runwaySuppressed
		) {
			return;
		}
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

	return {
		getSnapshot: () => snapshotOf(state),
		armImmediateTurn: () => {
			cancelMotion();
			cancelRunwayMotion();
			cancelAnchor();
			cancelEdgePin();
			pendingSettleReturn = false;
			runwaySuppressed = false;
			writeRunwayHeight(0);
			publish({ following: true, runway: true });
		},
		userTurnArrived: (index, source) => {
			if (source === "queued" && !state.following) return;
			cancelMotion();
			cancelEdgePin();
			if (source === "immediate") publish({ following: true, runway: true });
			const viewportHeight = environment.readViewportHeight();
			if (viewportHeight <= 0) return;
			const inset = turnInset(viewportHeight);
			cancelAnchor();
			anchorFrame = environment.requestFrame(() => {
				anchorFrame = null;
				if (state.following) environment.anchorTurn(index, inset);
			});
		},
		latestRowArrived: (index) => {
			if (latestEdge !== "top" || index !== 0 || !state.following) return;
			const bounds = environment.readScrollBounds();
			if (bounds) moveTo(latestScrollTop(bounds), false, false);
		},
		contentChanged,
		cancelMovement: () => {
			cancelMotion();
			cancelAnchor();
			cancelEdgePin();
		},
		readerLeft: () => {
			if (!state.following) return;
			cancelMotion();
			cancelAnchor();
			cancelEdgePin();
			publish({ following: false });
			releaseRunway(true);
		},
		readerReachedEdge: () => {
			cancelRunwayMotion();
			runwaySuppressed = false;
			publish({ following: true, runway: state.streaming });
		},
		returnToEdge: () => {
			cancelMotion();
			cancelAnchor();
			cancelRunwayMotion();
			runwaySuppressed = false;
			publish({ following: true, runway: state.streaming });
			if (!state.streaming) {
				pinLatestEdge();
				return;
			}
			const geometry = environment.readGeometry();
			if (!geometry || !moveEdgeToSettle(geometry, true)) pendingSettleReturn = true;
		},
		releaseRunway,
		setStreaming: (nextStreaming) => {
			if (!nextStreaming) {
				cancelMotion();
				publish({ streaming: false });
				releaseRunway(true);
				return;
			}
			cancelRunwayMotion();
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
			cancelRunwayMotion();
			runwaySuppressed = false;
			publish({ runway: true });
			if (!moveEdgeToSettle(geometry, false)) pendingSettleReturn = true;
		},
		setLatestEdge: (edge) => {
			if (edge === latestEdge) return;
			cancelMotion();
			cancelRunwayMotion();
			cancelAnchor();
			cancelEdgePin();
			latestEdge = edge;
			activeStreamMount = state.streaming;
			reconstructed = false;
			pendingSettleReturn = false;
			runwaySuppressed = false;
			writeRunwayHeight(0);
			publish({ following: true, runway: state.streaming });
		},
		dispose: () => {
			cancelMotion();
			cancelRunwayMotion();
			cancelAnchor();
			cancelEdgePin();
			pendingSettleReturn = false;
		},
	};
}
