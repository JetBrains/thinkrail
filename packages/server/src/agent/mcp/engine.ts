import {
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionEvent,
	type ExtensionHandler,
	type InlineExtension,
	type LoadedMcpConfig,
	type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";

const TOOL_SEARCH = "tool_search";

type ShutdownHandler = ExtensionHandler<SessionShutdownEvent>;

export interface McpEngine {
	extensions: InlineExtension[];
	shutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void>;
}

function activateToolSearchForRegisteredServers(pi: ExtensionAPI): void {
	if (pi.getMcpServers().length === 0) return;
	const active = pi.getActiveTools();
	if (active.includes(TOOL_SEARCH)) return;
	if (!pi.getAllTools().some((tool) => tool.name === TOOL_SEARCH)) return;
	pi.setActiveTools([...active, TOOL_SEARCH]);
}

function engineApi(pi: ExtensionAPI): { api: ExtensionAPI; shutdown: McpEngine["shutdown"] } {
	const shutdownHandlers: ShutdownHandler[] = [];
	let closed = false;
	let cleanup: Promise<void> | undefined;
	const shutdown: McpEngine["shutdown"] = (event, ctx) => {
		closed = true;
		cleanup ??= (async () => {
			for (const handler of shutdownHandlers) await handler(event, ctx);
		})();
		return cleanup;
	};
	const on = (event: string, handler: ExtensionHandler<ExtensionEvent>): (() => void) => {
		if (event === "session_shutdown") {
			shutdownHandlers.push(handler);
			return pi.on("session_shutdown", shutdown);
		}
		const guarded: typeof handler = (event, ctx) => {
			if (!closed) return handler(event, ctx);
		};
		return Reflect.apply(pi.on, pi, [
			event,
			event === "session_start" || event === "mcp_servers_change" ? guarded : handler,
		]);
	};
	return {
		api: new Proxy(pi, {
			get: (target, key) => (key === "on" ? on : Reflect.get(target, key)),
		}),
		shutdown,
	};
}

export function createMcpEngine(options: {
	loadConfig: (ctx: ExtensionContext) => LoadedMcpConfig;
}): McpEngine {
	const mcp = createMcpExtension({ loadConfig: options.loadConfig, openUrl: () => {} });
	let shutdown: McpEngine["shutdown"] = async () => {};
	return {
		extensions: [
			{
				name: "mcp",
				replaceable: true,
				builtin: true,
				factory: (pi) => {
					const load = engineApi(pi);
					shutdown = load.shutdown;
					load.api.on("session_start", () => activateToolSearchForRegisteredServers(pi));
					load.api.on("mcp_servers_change", () => activateToolSearchForRegisteredServers(pi));
					return mcp(load.api);
				},
			},
			{
				name: "tool-search",
				replaceable: true,
				builtin: true,
				factory: createToolSearchExtension(),
			},
		],
		shutdown: (event, ctx) => shutdown(event, ctx),
	};
}
