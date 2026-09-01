const TURN_INSET_RATIO = 0.1;
const TURN_INSET_MIN = 48;
const TURN_INSET_MAX = 80;
const RESPONSE_RUNWAY_RATIO = 0.6;
const EDGE_TRIGGER_RATIO = 0.82;
const EDGE_SETTLE_RATIO = 0.58;
const TAIL_RUNWAY_RATIO = 1 - EDGE_SETTLE_RATIO;
const ADVANCE_DURATION_MS = 220;
const EDGE_PIN_MAX_FRAMES = 30;
const GEOMETRY_EPSILON = 0.5;

export type ReadingBandLatestEdge = "top" | "bottom";

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
	setStreaming: (streaming: boolean) => void;
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
	{ streaming, latestEdge = "bottom" }: { streaming: boolean; latestEdge?: ReadingBandLatestEdge },
): ReadingBandController {
	let state: ReadingBandState = {
		following: true,
		moving: false,
		runway: streaming,
		streaming,
	};
	let frame: number | null = null;
	let anchorFrame: number | null = null;
	let edgePinFrame: number | null = null;
	let activeStreamMount = streaming;
	let reconstructed = false;
	let runwayMode: "turn" | "floor" | null = null;
	let runwayStartEdge: number | null = null;
	let runwayHeight: number | null = null;
	let runwayViewportHeight: number | null = null;
	let pendingTurnRunway = false;

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

	const cancelAnchor = () => {
		if (anchorFrame !== null) environment.cancelFrame(anchorFrame);
		anchorFrame = null;
	};

	const cancelEdgePin = () => {
		if (edgePinFrame !== null) environment.cancelFrame(edgePinFrame);
		edgePinFrame = null;
	};

	const writeRunwayHeight = (height: number) => {
		const pixels = Math.round(height);
		if (runwayHeight !== null && Math.abs(runwayHeight - pixels) <= GEOMETRY_EPSILON) return;
		runwayHeight = pixels;
		environment.writeRunwayHeight(pixels);
	};

	const beginTurnRunway = (geometry: ReadingBandGeometry): boolean => {
		const bottom = runwayBottom(geometry);
		if (bottom === null) return false;
		pendingTurnRunway = false;
		runwayMode = "turn";
		runwayStartEdge = geometry.scrollTop + bottom;
		runwayViewportHeight = geometry.viewportHeight;
		writeRunwayHeight(geometry.viewportHeight * (RESPONSE_RUNWAY_RATIO + TAIL_RUNWAY_RATIO));
		return true;
	};

	const resizeRunway = (geometry: ReadingBandGeometry) => {
		if (runwayMode === null || runwayHeight === null) return;
		const viewportChanged =
			runwayViewportHeight === null ||
			Math.abs(runwayViewportHeight - geometry.viewportHeight) > GEOMETRY_EPSILON;
		const floor = geometry.viewportHeight * TAIL_RUNWAY_RATIO;
		if (runwayMode === "floor") {
			runwayViewportHeight = geometry.viewportHeight;
			if (viewportChanged) writeRunwayHeight(floor);
			return;
		}
		if (runwayStartEdge === null) return;
		const bottom = runwayBottom(geometry);
		if (bottom === null) return;
		runwayViewportHeight = geometry.viewportHeight;
		const growth = Math.max(0, geometry.scrollTop + bottom - runwayStartEdge);
		const available =
			geometry.viewportHeight * (RESPONSE_RUNWAY_RATIO + TAIL_RUNWAY_RATIO) - growth;
		const next = Math.max(floor, available);
		writeRunwayHeight(viewportChanged ? next : Math.min(runwayHeight, next));
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
		if (!bounds || Math.abs(target - bounds.scrollTop) <= GEOMETRY_EPSILON) return;
		cancelMotion();
		if (environment.prefersReducedMotion()) {
			environment.writeScrollTop(target);
			return;
		}

		const start = bounds.scrollTop;
		const distance = target - start;
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

	const contentChanged = () => {
		let geometry = environment.readGeometry();
		if (!geometry || geometry.viewportHeight <= 0) return;
		if (pendingTurnRunway) beginTurnRunway(geometry);
		resizeRunway(geometry);
		if (!state.streaming || !state.following || state.moving) return;
		geometry = environment.readGeometry() ?? geometry;
		const bottom = geometry.edgeBottom;
		if (bottom === null) return;
		const trigger = geometry.viewportHeight * EDGE_TRIGGER_RATIO;
		if (bottom <= trigger + GEOMETRY_EPSILON) return;
		const target = Math.min(
			geometry.maxScrollTop,
			geometry.scrollTop + bottom - geometry.viewportHeight * EDGE_SETTLE_RATIO,
		);
		if (target <= geometry.scrollTop + GEOMETRY_EPSILON) return;
		moveTo(target, true, true);
	};

	return {
		getSnapshot: () => snapshotOf(state),
		armImmediateTurn: () => {
			cancelMotion();
			cancelAnchor();
			cancelEdgePin();
			pendingTurnRunway = false;
			publish({ following: true, runway: true });
		},
		userTurnArrived: (index, source) => {
			if (source === "queued" && !state.following) return;
			cancelMotion();
			cancelEdgePin();
			if (source === "immediate") publish({ following: true, runway: true });
			const viewportHeight = environment.readViewportHeight();
			if (viewportHeight <= 0) return;
			const geometry = environment.readGeometry();
			if (!geometry || !beginTurnRunway(geometry)) pendingTurnRunway = true;
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
			cancelMotion();
			cancelAnchor();
			cancelEdgePin();
			publish({ following: false });
		},
		readerReachedEdge: () => publish({ following: true }),
		returnToEdge: () => {
			cancelMotion();
			cancelAnchor();
			publish({ following: true });
			pinLatestEdge();
		},
		setStreaming: (nextStreaming) => {
			if (!nextStreaming) cancelMotion();
			publish({
				streaming: nextStreaming,
				...(nextStreaming ? { runway: true } : {}),
			});
		},
		reconstructActiveStream: () => {
			if (!activeStreamMount || !state.streaming || reconstructed) return;
			let geometry = environment.readGeometry();
			if (!geometry) return;
			reconstructed = true;
			pendingTurnRunway = false;
			publish({ runway: true });
			runwayMode = "floor";
			runwayStartEdge = null;
			runwayViewportHeight = geometry.viewportHeight;
			writeRunwayHeight(geometry.viewportHeight * TAIL_RUNWAY_RATIO);
			geometry = environment.readGeometry() ?? geometry;
			environment.writeScrollTop(latestScrollTop(geometry));
		},
		setLatestEdge: (edge) => {
			if (edge === latestEdge) return;
			cancelMotion();
			cancelAnchor();
			cancelEdgePin();
			latestEdge = edge;
			activeStreamMount = state.streaming;
			reconstructed = false;
			pendingTurnRunway = false;
			runwayMode = null;
			runwayStartEdge = null;
			runwayHeight = null;
			runwayViewportHeight = null;
			publish({ following: true, runway: state.streaming });
		},
		dispose: () => {
			cancelMotion();
			cancelAnchor();
			cancelEdgePin();
			pendingTurnRunway = false;
		},
	};
}
