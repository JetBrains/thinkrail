import { admissionContextFor, getSessionCommands, listSkillCatalog } from "../agent";
import { gitAsync } from "../git";
import { listProjects } from "../projects";
import type { SpeechScope, VocabularySource } from "../speech";
import { getWorkspace } from "../workspaces";

const LS_FILES_TIMEOUT_MS = 1_000;

function tryOr<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}

/** Gathers a dictation's project words; the `speech` module ranks and caps them. */
export async function speechVocabulary(scope: SpeechScope): Promise<VocabularySource> {
	const commands = scope.sessionId
		? tryOr(() => getSessionCommands(scope.sessionId ?? "").map((command) => command.name), [])
		: [];
	const workspace = scope.workspaceId
		? tryOr(() => getWorkspace(scope.workspaceId ?? ""), null)
		: null;
	if (!workspace) return { commands, paths: [] };
	if (commands.length === 0) {
		const project = listProjects().find((candidate) => candidate.id === workspace.projectId);
		const skills = await listSkillCatalog(
			workspace.worktreePath,
			admissionContextFor(project, workspace.skillOverrides ?? {}),
		).catch(() => []);
		commands.push(...skills.map((skill) => skill.name));
	}
	const files = await gitAsync(
		workspace.worktreePath,
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ timeoutMs: LS_FILES_TIMEOUT_MS },
	);
	return { commands, paths: files.ok ? files.out.split("\0").filter(Boolean) : [] };
}
