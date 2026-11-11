import type { FindInFilesTarget } from "../findInFiles";
import { openFileAtLine } from "../panels/openTabs";
import { paletteNavigator } from "./paletteNavigation";

/** Opens a match's file at its line once the shared navigator entered its workspace; a refused or overtaken pick opens nothing. */
export async function openFindInFilesMatch(
	target: FindInFilesTarget,
	keep: boolean,
	navigateToWorkspace = paletteNavigator.navigateToWorkspace,
	openAt: typeof openFileAtLine = openFileAtLine,
): Promise<void> {
	if (!(await navigateToWorkspace({ id: target.workspaceId, projectId: target.projectId }))) return;
	await openAt(
		target.workspaceId,
		target.path,
		{ line: target.line, column: target.column, length: target.length },
		keep ? "keep" : "preview",
	);
}
