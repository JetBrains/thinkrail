/** WebSocket client to the host: id-correlated requests + channel subscriptions, reconnect. */

export type { ConnectionStatus, TransportOptions } from "./transport";
export { getTransport, initTransport } from "./wireTransport";
