import {
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionHandler,
	type InlineExtension,
	type LoadedMcpConfig,
	type RegisteredCommand,
	type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import { acquireMcpSignInLock } from "./signInLock";

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

function lockingSignIns(handler: RegisteredCommand["handler"]): RegisteredCommand["handler"] {
	return async (args, ctx) => {
		const [action, name, ...extra] = args.trim().split(/\s+/).filter(Boolean);
		if ((action !== "login" && action !== "logout") || !name || extra.length > 0) {
			return handler(args, ctx);
		}
		const lock = acquireMcpSignInLock(name, "chat");
		if ("heldBy" in lock) {
			const where = lock.heldBy === "settings" ? "in Settings" : "in a chat";
			ctx.ui.notify(`A sign-in for "${name}" is already running ${where}.`, "warning");
			return;
		}
		try {
			await handler(args, ctx);
		} finally {
			lock.release();
		}
	};
}

function engineApi(
	pi: ExtensionAPI,
	lockSignIns: boolean,
	shutdownHandlers: ShutdownHandler[],
): ExtensionAPI {
	const registerCommand: ExtensionAPI["registerCommand"] = (name, options) =>
		pi.registerCommand(
			name,
			lockSignIns && name === "mcp"
				? { ...options, handler: lockingSignIns(options.handler) }
				: options,
		);
	const on = (event: string, handler: ShutdownHandler): (() => void) => {
		if (event === "session_shutdown") shutdownHandlers.push(handler);
		return Reflect.apply(pi.on, pi, [event, handler]);
	};
	return new Proxy(pi, {
		get: (target, key) =>
			key === "registerCommand" ? registerCommand : key === "on" ? on : Reflect.get(target, key),
	});
}

export function createMcpEngine(options: {
	loadConfig: (ctx: ExtensionContext) => LoadedMcpConfig;
	lockSignIns?: boolean;
}): McpEngine {
	const mcp = createMcpExtension({ loadConfig: options.loadConfig, openUrl: () => {} });
	const lockSignIns = options.lockSignIns ?? true;
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
					return mcp(engineApi(pi, lockSignIns, shutdownHandlers));
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
