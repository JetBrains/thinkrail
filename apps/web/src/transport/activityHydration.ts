import type { SessionActivity, SessionActivityPayload } from "@thinkrail/contracts";

export interface ActivityHydrationSink {
	apply: (payload: SessionActivityPayload) => void;
	hydrate: (rows: SessionActivity[]) => void;
}

export interface ActivityHydration {
	push: (payload: SessionActivityPayload) => void;
	begin: () => number;
	settle: (token: number, rows: SessionActivity[]) => void;
	fail: (token: number) => void;
	discard: (token: number) => void;
	abandon: () => void;
	buffered: () => number;
}

export function createActivityHydration(sink: ActivityHydrationSink): ActivityHydration {
	let token = 0;
	let buffer: SessionActivityPayload[] | null = null;

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
