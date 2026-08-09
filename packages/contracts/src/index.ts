// The wire spine. Types-only except the WS method/channel constants + protocol version (wsProtocol), the
// app-config default (`DEFAULT_CONFIG`), the history-search caps (`MAX_HISTORY_LIMIT`,
// `MAX_HISTORY_QUERY_LENGTH`), and the internal control-message marker (`TODO_NUDGE_PREFIX` +
// its shared `isControlMessage` reading) — small
// plain constants both sides must agree on. Theme catalogs stay browser-side; the wire carries an opaque id.

export type * from "./domain";
export {
	DEFAULT_CONFIG,
	isControlMessage,
	MAX_HISTORY_LIMIT,
	MAX_HISTORY_QUERY_LENGTH,
	TERMINAL_REPLAY_KB,
	TODO_NUDGE_PREFIX,
} from "./domain";
export type * from "./piProtocol";
export * from "./wsProtocol";
