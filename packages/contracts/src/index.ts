// The wire spine. Types-only except the WS method/channel constants + protocol version (wsProtocol), the
// app-config default (`DEFAULT_CONFIG`), the history-search caps (`MAX_HISTORY_LIMIT`,
// `MAX_HISTORY_QUERY_LENGTH`), and the internal control-message marker (`TODO_NUDGE_PREFIX` +
// its shared `isControlMessage` reading, plus the shared `isRetriedAttempt` transcript reading and the
// shared image payload ceiling `IMAGE_MAX_BASE64_BYTES` + `base64EncodedLength` measurement), and the
// transcript-role policy (`isTranscriptMessageRole`, the one set the host's transcript filter and
// its search index must share) — small
// plain constants both sides must agree on. Theme catalogs stay browser-side; the wire carries an opaque id.

export type * from "./domain";
export {
	ACCEPTED_IMAGE_TYPES,
	base64EncodedLength,
	DEFAULT_CONFIG,
	IMAGE_MAX_BASE64_BYTES,
	isControlMessage,
	isRetriedAttempt,
	MAX_HISTORY_LIMIT,
	MAX_HISTORY_QUERY_LENGTH,
	REQUEST_IMAGE_BASE64_BUDGET,
	TERMINAL_REPLAY_KB,
	TODO_NUDGE_PREFIX,
} from "./domain";
export type * from "./piProtocol";
export { isTranscriptMessageRole } from "./piProtocol";
export * from "./wsProtocol";
