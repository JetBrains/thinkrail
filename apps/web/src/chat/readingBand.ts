const TURN_INSET_RATIO = 0.1;
const TURN_INSET_MIN = 48;
const TURN_INSET_MAX = 80;
const RESPONSE_RUNWAY_RATIO = 0.6;
const EDGE_TRIGGER_RATIO = 0.82;
const EDGE_SETTLE_RATIO = 0.58;
const TAIL_RUNWAY_RATIO = 1 - EDGE_SETTLE_RATIO;
const ADVANCE_DURATION_MS = 220;
const GEOMETRY_EPSILON = 0.5;

export interface ReadingBandGeometry {
	viewportHeight: number;
	scrollTop: number;
	maxScrollTop: number;
	edgeBottom: number;
}

export interface ReadingBandSnapshot {
	following: boolean;
	moving: boolean;
	runway: boolean;
	buttonLabel: "Follow response" | "Latest" | null;
}

export interface ReadingBandEnvironment {
	readGeometry: () => ReadingBandGeometry | null;
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
	contentChanged: () => void;
	readerLeft: () => void;
	readerReachedEdge: () => void;
	returnToEdge: () => void;
	setStreaming: (streaming: boolean) => void;
	reconstructActiveStream: () => void;
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

export function createReadingBandController(
	environment: ReadingBandEnvironment,
	{ streaming }: { streaming: boolean },
): ReadingBandController {
	let state: ReadingBandState = {
		following: true,
		moving: false,
		runway: streaming,
		streaming,
	};
	let frame: number | null = null;
	let anchorFrame: number | null = null;
	const activeStreamMount = streaming;
	let reconstructed = false;
	let runwayMode: "turn" | "floor" | null = null;
	let runwayStartEdge: number | null = null;
	let runwayHeight: number | null = null;
	let runwayViewportHeight: number | null = null;

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

	const writeRunwayHeight = (height: number) => {
		const pixels = Math.round(height);
		if (runwayHeight !== null && Math.abs(runwayHeight - pixels) <= GEOMETRY_EPSILON) return;
		runwayHeight = pixels;
		environment.writeRunwayHeight(pixels);
	};

	const beginTurnRunway = (geometry: ReadingBandGeometry) => {
		runwayMode = "turn";
		runwayStartEdge = geometry.scrollTop + geometry.edgeBottom;
		runwayViewportHeight = geometry.viewportHeight;
		writeRunwayHeight(geometry.viewportHeight * (RESPONSE_RUNWAY_RATIO + TAIL_RUNWAY_RATIO));
	};

	const resizeRunway = (geometry: ReadingBandGeometry) => {
		if (runwayMode === null || runwayHeight === null) return;
		const viewportChanged =
			runwayViewportHeight === null ||
			Math.abs(runwayViewportHeight - geometry.viewportHeight) > GEOMETRY_EPSILON;
		runwayViewportHeight = geometry.viewportHeight;
		const floor = geometry.viewportHeight * TAIL_RUNWAY_RATIO;
		if (runwayMode === "floor") {
			if (viewportChanged) writeRunwayHeight(floor);
			return;
		}
		if (runwayStartEdge === null) return;
		const growth = Math.max(0, geometry.scrollTop + geometry.edgeBottom - runwayStartEdge);
		const available =
			geometry.viewportHeight * (RESPONSE_RUNWAY_RATIO + TAIL_RUNWAY_RATIO) - growth;
		const next = Math.max(floor, available);
		writeRunwayHeight(viewportChanged ? next : Math.min(runwayHeight, next));
	};

	const contentChanged = () => {
		let geometry = environment.readGeometry();
		if (!geometry || geometry.viewportHeight <= 0) return;
		resizeRunway(geometry);
		if (!state.streaming || !state.following || state.moving) return;
		geometry = environment.readGeometry() ?? geometry;
		const trigger = geometry.viewportHeight * EDGE_TRIGGER_RATIO;
		if (geometry.edgeBottom <= trigger + GEOMETRY_EPSILON) return;
		const target = Math.min(
			geometry.maxScrollTop,
			geometry.scrollTop + geometry.edgeBottom - geometry.viewportHeight * EDGE_SETTLE_RATIO,
		);
		if (target <= geometry.scrollTop + GEOMETRY_EPSILON) return;
		if (environment.prefersReducedMotion()) {
			environment.writeScrollTop(target);
			return;
		}

		const start = geometry.scrollTop;
		const distance = target - start;
		const startedAt = environment.now();
		publish({ moving: true });
		const advance = (time: number) => {
			if (!state.following || !state.streaming) return;
			const progress = Math.min(1, Math.max(0, (time - startedAt) / ADVANCE_DURATION_MS));
			environment.writeScrollTop(start + distance * easeOutCubic(progress));
			if (progress < 1) {
				frame = environment.requestFrame(advance);
				return;
			}
			frame = null;
			publish({ moving: false });
			contentChanged();
		};
		frame = environment.requestFrame(advance);
	};

	return {
		getSnapshot: () => snapshotOf(state),
		armImmediateTurn: () => {
			cancelMotion();
			cancelAnchor();
			publish({ following: true, runway: true });
		},
		userTurnArrived: (index, source) => {
			if (source === "queued" && !state.following) return;
			if (source === "immediate") publish({ following: true, runway: true });
			const geometry = environment.readGeometry();
			if (!geometry || geometry.viewportHeight <= 0) return;
			beginTurnRunway(geometry);
			const inset = turnInset(geometry.viewportHeight);
			cancelAnchor();
			anchorFrame = environment.requestFrame(() => {
				anchorFrame = null;
				if (state.following) environment.anchorTurn(index, inset);
			});
		},
		contentChanged,
		readerLeft: () => {
			cancelMotion();
			cancelAnchor();
			publish({ following: false });
		},
		readerReachedEdge: () => publish({ following: true }),
		returnToEdge: () => {
			cancelMotion();
			cancelAnchor();
			publish({ following: true });
			const geometry = environment.readGeometry();
			if (geometry) environment.writeScrollTop(geometry.maxScrollTop);
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
			publish({ runway: true });
			runwayMode = "floor";
			runwayStartEdge = null;
			runwayViewportHeight = geometry.viewportHeight;
			writeRunwayHeight(geometry.viewportHeight * TAIL_RUNWAY_RATIO);
			geometry = environment.readGeometry() ?? geometry;
			environment.writeScrollTop(geometry.maxScrollTop);
		},
		dispose: () => {
			cancelMotion();
			cancelAnchor();
		},
	};
}
