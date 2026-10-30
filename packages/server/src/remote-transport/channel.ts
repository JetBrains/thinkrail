/**
 * A transport-agnostic bidirectional byte channel that the existing host↔client wire protocol runs over.
 * The WebRTC DataChannel adapter (next slice) implements this; keeping the wire protocol behind this
 * interface lets it be driven in tests by an in-memory channel, with no WebRTC dependency.
 */
export interface RemoteChannel {
	send(data: Uint8Array): void;
	onMessage(handler: (data: Uint8Array) => void): void;
	onClose(handler: () => void): void;
	close(): void;
	readonly open: boolean;
}
