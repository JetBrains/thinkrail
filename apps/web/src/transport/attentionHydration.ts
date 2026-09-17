import type { SessionAttention, SessionAttentionPayload } from "@thinkrail/contracts";

export interface SnapshotHydrationSink<Row, PushPayload> {
	apply: (payload: PushPayload) => void;
	hydrate: (rows: Row[]) => void;
}

export interface SnapshotHydration<Row, PushPayload> {
	push: (payload: PushPayload) => void;
	begin: () => number;
	settle: (token: number, rows: Row[]) => void;
	fail: (token: number) => void;
	discard: (token: number) => void;
	abandon: () => void;
	buffered: () => number;
}

export function createTokenizedSnapshotHydrator<Row, PushPayload>(
	sink: SnapshotHydrationSink<Row, PushPayload>,
): SnapshotHydration<Row, PushPayload> {
	let token = 0;
	let buffer: PushPayload[] | null = null;

	const drain = (): void => {
		const pending = buffer ?? [];
		buffer = null;
		for (const payload of pending) sink.apply(payload);
	};

	return {
		push: (payload) => {
			if (buffer) buffer.push(payload);
			else sink.apply(payload);
		},
		begin: () => {
			token += 1;
			buffer = [];
			return token;
		},
		settle: (requestToken, rows) => {
			if (requestToken !== token) return;
			sink.hydrate(rows);
			drain();
		},
		fail: (requestToken) => {
			if (requestToken !== token) return;
			drain();
		},
		discard: (requestToken) => {
			if (requestToken !== token) return;
			buffer = null;
		},
		abandon: () => {
			token += 1;
			buffer = null;
		},
		buffered: () => buffer?.length ?? 0,
	};
}

export type AttentionHydrationSink = SnapshotHydrationSink<
	SessionAttention,
	SessionAttentionPayload
>;

export type AttentionHydration = SnapshotHydration<SessionAttention, SessionAttentionPayload>;

export function createAttentionHydration(sink: AttentionHydrationSink): AttentionHydration {
	return createTokenizedSnapshotHydrator(sink);
}
