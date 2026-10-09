import {
	createMcpExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionEvent,
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

function observingCommands(
	handler: RegisteredCommand["handler"],
	lockSignIns: boolean,
	onCommandSettled?: (sessionId: string) => void,
): RegisteredCommand["handler"] {
	return async (args, ctx) => {
		const [action, name, ...extra] = args.trim().split(/\s+/).filter(Boolean);
		const mutates =
			(action === "login" || action === "logout" || action === "reconnect") && extra.length === 0;
		if (!mutates) return handler(args, ctx);
		const sessionId = onCommandSettled ? ctx.sessionManager.getSessionId() : undefined;
		const lock =
			lockSignIns && name && (action === "login" || action === "logout")
				? acquireMcpSignInLock(name, "chat")
				: undefined;
		if (lock && "heldBy" in lock) {
			const where = lock.heldBy === "settings" ? "in Settings" : "in a chat";
			ctx.ui.notify(`A sign-in for "${name}" is already running ${where}.`, "warning");
			return;
		}
		try {
			await handler(args, ctx);
		} finally {
			lock?.release();
			if (sessionId !== undefined) onCommandSettled?.(sessionId);
		}
	};
}

function engineApi(
	pi: ExtensionAPI,
	lockSignIns: boolean,
	onCommandSettled?: (sessionId: string) => void,
): { api: ExtensionAPI; shutdown: McpEngine["shutdown"] } {
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
	const registerCommand: ExtensionAPI["registerCommand"] = (name, options) =>
		pi.registerCommand(
			name,
			name === "mcp"
				? { ...options, handler: observingCommands(options.handler, lockSignIns, onCommandSettled) }
				: options,
		);
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
			get: (target, key) =>
				key === "registerCommand" ? registerCommand : key === "on" ? on : Reflect.get(target, key),
		}),
		shutdown,
	};
}

export function createMcpEngine(options: {
	loadConfig: (ctx: ExtensionContext) => LoadedMcpConfig;
	lockSignIns?: boolean;
	openUrl?: (url: string) => void;
	onCommandSettled?: (sessionId: string) => void;
}): McpEngine {
	const mcp = createMcpExtension({
		loadConfig: options.loadConfig,
		openUrl: options.openUrl ?? (() => {}),
	});
	const lockSignIns = options.lockSignIns ?? true;
	let shutdown: McpEngine["shutdown"] = async () => {};
	return {
		extensions: [
			{
				name: "mcp",
				replaceable: true,
				builtin: true,
				factory: (pi) => {
					const load = engineApi(pi, lockSignIns, options.onCommandSettled);
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
