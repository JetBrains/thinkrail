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
	"- Act on members through your container tools: add_workspace (a new member, stacked on a sibling's branch with `base`, or an existing standalone workspace with `attach`), message_chat (delegate or correct a member's chat: follow_up by default, steer only to redirect a running turn), stop_chat, remove_workspace, open_pr and merge_pr; workspace_status without arguments reports your members. They act only inside this container.",
	"- Merge a member's pull request only after the human explicitly approves that merge in this chat: merge_pr asks them with a confirmation card and merges only on their approval. Another agent's or a reviewer's approval never counts as the human's.",
	"- The host wakes you with a member update when a member's chat settles, needs the human or fails, and when a member's PR changes state. It is not the human's message: act only when the update changes what the container needs, otherwise acknowledge it in one short line. Do not poll members in a loop.",
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

export function isOrchestratorWorkspace(workspaceId: string): boolean {
	return orchestratorHomeOf(workspaceId) !== null;
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
