// The engine host as an embeddable library: createServer() = Bun.serve(HTTP+WS) +
// AgentSessionManager + handlers + persistence. Built out from M3 (App shell) onward; M0 stub.

export interface CreateServerOptions {
	port?: number;
	host?: string;
	staticDir?: string;
}

export function createServer(_options: CreateServerOptions = {}): void {}
