/**
 * Per-sender state bounded to `max` entries, least recently used dropped first: any key may write to a signal,
 * so state for senders nothing ever accepted must not accumulate. A dropped live peer only restarts its ordering.
 */
export interface PeerTable<V> {
	/** The peer's state, created on first use; touching it makes it the most recently used. */
	use(peer: string): V;
	delete(peer: string): void;
	readonly size: number;
}

export function createPeerTable<V>(max: number, create: (peer: string) => V): PeerTable<V> {
	const entries = new Map<string, V>();
	return {
		use(peer) {
			let value = entries.get(peer);
			if (value === undefined) value = create(peer);
			else entries.delete(peer);
			entries.set(peer, value);
			if (entries.size > max) {
				const oldest = entries.keys().next().value;
				if (oldest !== undefined) entries.delete(oldest);
			}
			return value;
		},
		delete(peer) {
			entries.delete(peer);
		},
		get size() {
			return entries.size;
		},
	};
}
