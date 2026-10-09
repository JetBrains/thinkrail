import {
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
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

function engineApi(pi: ExtensionAPI, shutdownHandlers: ShutdownHandler[]): ExtensionAPI {
	const on = (event: string, handler: ShutdownHandler): (() => void) => {
		if (event === "session_shutdown") shutdownHandlers.push(handler);
		return Reflect.apply(pi.on, pi, [event, handler]);
	};
	return new Proxy(pi, {
		get: (target, key) => (key === "on" ? on : Reflect.get(target, key)),
	});
}

export function createMcpEngine(options: {
	loadConfig: (ctx: ExtensionContext) => LoadedMcpConfig;
}): McpEngine {
	const mcp = createMcpExtension({ loadConfig: options.loadConfig, openUrl: () => {} });
	let shutdownHandlers: ShutdownHandler[] = [];
	return {
		extensions: [
			{
				name: "mcp",
				replaceable: true,
				builtin: true,
				factory: (pi) => {
					shutdownHandlers = [];
					pi.on("session_start", () => activateToolSearchForRegisteredServers(pi));
					pi.on("mcp_servers_change", () => activateToolSearchForRegisteredServers(pi));
					return mcp(engineApi(pi, shutdownHandlers));
				},
			},
			{
				name: "tool-search",
				replaceable: true,
				builtin: true,
				factory: createToolSearchExtension(),
			},
		],
		shutdown: async (event, ctx) => {
			for (const handler of shutdownHandlers) await handler(event, ctx);
		},
	};
}
