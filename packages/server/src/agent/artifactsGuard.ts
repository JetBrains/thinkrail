import { lstatSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { WORKSPACE_CONTEXT_DIR } from "@thinkrail/shared/paths";

export const ARTIFACTS_SECTION = "thinkrail-artifacts";

export const ARTIFACTS_RULE = [
	`Keep everything you produce for the user in this workspace's \`${WORKSPACE_CONTEXT_DIR}/\` folder: reports, notes, plans, mockups, screenshots, generated images, exported data and any other output that is not project code. It stays out of git, and the user finds it in the Artifacts tab.`,
	"- Never put such output in /tmp or another temporary folder: it disappears there and the user never sees it.",
	`- Never delete or move files out of \`${WORKSPACE_CONTEXT_DIR}/\`; only the user removes artifacts. Update a file in place rather than replacing it.`,
].join("\n");

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function realish(path: string): string {
	const missing: string[] = [];
	let cursor = path;
	while (!lstatSync(cursor, { throwIfNoEntry: false })) {
		const parent = dirname(cursor);
		if (parent === cursor) return path;
		missing.unshift(basename(cursor));
		cursor = parent;
	}
	try {
		return join(realpathSync(cursor), ...missing);
	} catch {
		return path;
	}
}

function toolTarget(path: string, cwd: string): string {
	const bare = path.startsWith("@") ? path.slice(1) : path;
	if (bare === "~") return homedir();
	if (bare.startsWith("~/")) return join(homedir(), bare.slice(2));
	return resolve(cwd, bare);
}

function temporaryRoots(): string[] {
	const roots = new Set<string>(["/tmp", "/var/tmp", tmpdir()]);
	for (const name of ["TMPDIR", "TEMP", "TMP"]) {
		const value = process.env[name];
		if (value && isAbsolute(value)) roots.add(value);
	}
	for (const root of [...roots]) roots.add(realish(root));
	return [...roots];
}

export function temporaryWriteTarget(path: string, cwd: string): string | null {
	const target = toolTarget(path, cwd);
	const real = realish(target);
	if (inside(realish(cwd), real)) return null;
	return temporaryRoots().some((root) => inside(root, target) || inside(root, real))
		? target
		: null;
}

export const artifactsGuard: ExtensionFactory = (pi) => {
	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections[ARTIFACTS_SECTION] = ARTIFACTS_RULE;
	});
	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
		const path = event.input.path;
		if (typeof path !== "string" || !temporaryWriteTarget(path, ctx.cwd)) return undefined;
		return {
			block: true,
			reason: `${path} is in a temporary folder, where files disappear and the user never sees them. Write it inside the workspace under ${WORKSPACE_CONTEXT_DIR}/ instead (for example ${WORKSPACE_CONTEXT_DIR}/${basename(path)}).`,
		};
	});
};
