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

export function createReadingBandController(
	_environment: ReadingBandEnvironment,
	{ streaming }: { streaming: boolean },
): ReadingBandController {
	const snapshot: ReadingBandSnapshot = {
		following: true,
		moving: false,
		runway: streaming,
		buttonLabel: null,
	};
	return {
		getSnapshot: () => snapshot,
		armImmediateTurn: () => {},
		userTurnArrived: () => {},
		contentChanged: () => {},
		readerLeft: () => {},
		readerReachedEdge: () => {},
		returnToEdge: () => {},
		setStreaming: () => {},
		reconstructActiveStream: () => {},
		dispose: () => {},
	};
}
