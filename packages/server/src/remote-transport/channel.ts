/** A transport-agnostic bidirectional byte channel the host↔client wire protocol runs over. */
export interface RemoteChannel {
	send(data: Uint8Array): void;
	onMessage(handler: (data: Uint8Array) => void): void;
	onClose(handler: () => void): void;
	close(): void;
	readonly open: boolean;
}
