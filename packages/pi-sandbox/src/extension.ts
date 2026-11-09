import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createBashToolDefinition, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { canRead, canWrite, defaultSandboxPolicy, type SandboxPolicy } from "./policy";
import { createSandboxedBashOperations } from "./runtime";

export interface SandboxExtensionOptions {
	policyFor?(cwd: string): SandboxPolicy;
	shell?(): { shellPath?: string; commandPrefix?: string };
}

const SANDBOX_NOTE =
	"Commands run in a sandbox: writes are limited to the workspace and $TMPDIR (use $TMPDIR, not /tmp), credential stores such as ~/.ssh are unreadable, and network access is limited to package registries and GitHub. A denied operation fails with 'Operation not permitted' or a 403 from the proxy; report it instead of working around it.";

const WRITE_TOOLS = new Set(["write", "edit"]);
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

function toolPath(cwd: string, path: unknown): string {
	if (typeof path !== "string" || path === "") return resolve(cwd);
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return resolve(cwd, path);
}

export function createSandboxExtension(options: SandboxExtensionOptions = {}): ExtensionFactory {
	const policyFor = options.policyFor ?? ((cwd: string) => defaultSandboxPolicy(cwd));
	return (pi) => {
		const shape = createBashToolDefinition(process.cwd());
		pi.registerTool({
			...shape,
			label: "bash (sandboxed)",
			description: `${shape.description}\n\n${SANDBOX_NOTE}`,
			execute(toolCallId, params, signal, onUpdate, ctx) {
				const shell = options.shell?.() ?? {};
				const tool = createBashToolDefinition(ctx.cwd, {
					...shell,
					operations: createSandboxedBashOperations(policyFor, shell),
				});
				return tool.execute(toolCallId, params, signal, onUpdate, ctx);
			},
		});

		pi.on("user_bash", () => ({
			operations: createSandboxedBashOperations(policyFor, options.shell?.() ?? {}),
		}));

		pi.on("tool_call", (event, ctx) => {
			const isWrite = WRITE_TOOLS.has(event.toolName);
			if (!isWrite && !READ_TOOLS.has(event.toolName)) return;
			const path = toolPath(ctx.cwd, (event.input as { path?: unknown }).path);
			const policy = policyFor(ctx.cwd);
			if (isWrite ? canWrite(policy, path) : canRead(policy, path)) return;
			return {
				block: true,
				reason: `Sandbox: ${isWrite ? "writing" : "reading"} ${path} is outside this workspace's sandbox policy.`,
			};
		});
	};
}
