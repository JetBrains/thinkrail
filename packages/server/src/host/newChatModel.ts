import type { AppConfig, ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { clampThinkingForModel, listSettledModels } from "../agent";
import { getConfig } from "../settings";

type NewChatModelRequest = { model?: WireModel; thinkingLevel?: ThinkingLevel };
type ResolverDependencies = {
	getConfig: () => AppConfig;
	listSettledModels: typeof listSettledModels;
	clampThinkingForModel: typeof clampThinkingForModel;
};

export async function resolveNewChatModel(
	requested: NewChatModelRequest,
	dependencies: ResolverDependencies = { getConfig, listSettledModels, clampThinkingForModel },
): Promise<{ model: WireModel | null; thinkingLevel: ThinkingLevel }> {
	const config = dependencies.getConfig();
	const availableModels = await dependencies.listSettledModels();
	const savedModel = config.defaultModel;
	const model =
		requested.model ??
		availableModels.find(
			(candidate) => candidate.provider === savedModel?.provider && candidate.id === savedModel?.id,
		);
	const level = requested.thinkingLevel ?? config.defaultEffort ?? "medium";
	if (!model) return { model: null, thinkingLevel: level };
	return {
		model,
		thinkingLevel: await dependencies.clampThinkingForModel(
			{ provider: model.provider, id: model.id },
			level,
		),
	};
}
