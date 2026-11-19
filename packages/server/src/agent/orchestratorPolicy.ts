import { readdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";
import { inside, realish, toolTarget } from "./artifactsGuard";

export const ORCHESTRATOR_SECTION = "thinkrail-orchestrator";

/** The home's folder of member links, as `containers` lays it out. */
const MEMBER_LINKS_DIR = "workspaces";

export const ORCHESTRATOR_RULE = [
	"You are the orchestrator of the container whose home is your working folder: you coordinate its member workspaces, you do not implement.",
	`- Read each member's code through its link in \`${MEMBER_LINKS_DIR}/\` (one folder per member workspace, named \`<project>-<branch>\`).`,
	`- Write only the container's shared artifacts (plans, research, reports, task specs) under \`${WORKSPACE_CONTEXT_DIR}/\`.`,
	`- Never edit, create or delete files in a member's code, with any tool: file tools are refused under \`${MEMBER_LINKS_DIR}/\`, and the shell is no way around that rule. Delegate the change to that member workspace's own chat.`,
	"- Merge a member's pull request only after the human explicitly approves that merge in this chat. Another agent's or a reviewer's approval never counts as the human's.",
].join("\n");

let homeResolver: (workspaceId: string) => string | null = () => null;

/** Injected by the host: the home folder of the container a workspace's chat orchestrates, or `null`. */
export function setOrchestratorHomeResolver(
	resolver: ((workspaceId: string) => string | null) | null,
): void {
	homeResolver = resolver ?? (() => null);
}

function orchestratorHomeOf(workspaceId: string): string | null {
	try {
		return homeResolver(workspaceId);
	} catch {
		return null;
	}
}

function memberRoots(links: string): string[] {
	let names: string[];
	try {
		names = readdirSync(links);
	} catch {
		return [];
	}
	const roots: string[] = [];
	for (const name of names) {
		try {
			roots.push(realpathSync(join(links, name)));
		} catch {}
	}
	return roots;
}

/** The resolved target when a file tool's path lands in a member's code: under the home's links, or (real path) in a linked worktree. */
export function memberWriteTarget(path: string, cwd: string, home: string): string | null {
	const target = toolTarget(path, cwd);
	const links = join(home, MEMBER_LINKS_DIR);
	if (inside(links, target)) return target;
	const real = realish(target);
	if (inside(realish(links), real)) return target;
	return memberRoots(links).some((root) => inside(root, real)) ? target : null;
}

/** The orchestrator's role rule (parents only) and the guard keeping its file tools out of member code. */
export function orchestratorPolicy(
	workspaceId: string,
	{ rule = true }: { rule?: boolean } = {},
): ExtensionFactory {
	return (pi) => {
		if (rule) {
			pi.on("before_agent_start", (event) => {
				if (orchestratorHomeOf(workspaceId))
					event.systemPromptOptions.sections[ORCHESTRATOR_SECTION] = ORCHESTRATOR_RULE;
			});
		}
		pi.on("tool_call", (event, ctx) => {
			if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
			const path = event.input.path;
			if (typeof path !== "string") return undefined;
			const home = orchestratorHomeOf(workspaceId);
			const target = home ? memberWriteTarget(path, ctx.cwd, home) : null;
			if (!home || !target) return undefined;
			const shown = relative(home, target).startsWith("..") ? target : relative(home, target);
			return {
				block: true,
				reason: `${shown} is a member workspace's code, which the orchestrator never edits. Ask that workspace's own chat to make the change, and keep your notes under ${WORKSPACE_CONTEXT_DIR}/.`,
			};
		});
	};
}
