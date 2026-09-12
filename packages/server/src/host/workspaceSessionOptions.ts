import type { ThinkingLevel, WireModel, Workspace } from "@thinkrail/contracts";

export function workspaceSessionOptions(
	workspace: Workspace,
	request: { model?: WireModel; thinkingLevel?: ThinkingLevel },
): { model?: WireModel; thinkingLevel?: ThinkingLevel; modelOptional?: boolean } {
	if (request.model) {
		return {
			model: request.model,
			...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
		};
	}
	if (request.thinkingLevel) return { thinkingLevel: request.thinkingLevel };
	if (workspace.model && workspace.thinkingLevel) {
		return {
			model: workspace.model,
			thinkingLevel: workspace.thinkingLevel,
			modelOptional: true,
		};
	}
	return {};
}
