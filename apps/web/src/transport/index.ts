/** WebSocket client to the host: id-correlated requests + channel subscriptions, reconnect. */

export { errorText } from "./errorText";
export type { ConnectionStatus, TransportOptions } from "./transport";
export { getTransport, initTransport, refreshAuthStatus } from "./wireTransport";
