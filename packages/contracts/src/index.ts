// The wire spine. Types-only except the WS method/channel constants + protocol version (wsProtocol) and
// the app-config default (`DEFAULT_CONFIG`). Theme catalogs stay browser-side; the wire carries an opaque id.

export type * from "./domain";
export { DEFAULT_CONFIG } from "./domain";
export type * from "./piProtocol";
export * from "./wsProtocol";
