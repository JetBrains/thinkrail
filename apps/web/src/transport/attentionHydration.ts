import type { SessionAttention, SessionAttentionPayload } from "@thinkrail/contracts";

export interface AttentionHydrationSink {
	apply: (payload: SessionAttentionPayload) => void;
	hydrate: (rows: SessionAttention[]) => void;
}

export interface AttentionHydration {
	push: (payload: SessionAttentionPayload) => void;
	begin: () => number;
	settle: (token: number, rows: SessionAttention[]) => void;
	fail: (token: number) => void;
	discard: (token: number) => void;
	abandon: () => void;
	buffered: () => number;
}

export function createAttentionHydration(sink: AttentionHydrationSink): AttentionHydration {
	let token = 0;
	let buffer: SessionAttentionPayload[] | null = null;

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
