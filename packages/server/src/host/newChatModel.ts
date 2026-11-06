import {
	type AppConfig,
	sameModel,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import {
	clampThinkingForModel,
	listSettledModels,
	piDefaultModelRef,
	preferredDefaultModel,
} from "../agent";
import { getConfig } from "../settings";

type NewChatModelRequest = { model?: WireModel; thinkingLevel?: ThinkingLevel };
type ResolverDependencies = {
	getConfig: () => AppConfig;
	listSettledModels: typeof listSettledModels;
	piDefaultModelRef: typeof piDefaultModelRef;
	clampThinkingForModel: typeof clampThinkingForModel;
};

export async function resolveNewChatModel(
	requested: NewChatModelRequest,
	dependencies: ResolverDependencies = {
		getConfig,
		listSettledModels,
		piDefaultModelRef,
		clampThinkingForModel,
	},
): Promise<{ model: WireModel | null; thinkingLevel: ThinkingLevel }> {
	const config = dependencies.getConfig();
	const availableModels = await dependencies.listSettledModels();
	const findAvailable = (ref: Parameters<typeof sameModel>[1]) =>
		availableModels.find((candidate) => sameModel(candidate, ref));
	const model =
		requested.model ??
		findAvailable(config.defaultModel) ??
		findAvailable(dependencies.piDefaultModelRef()) ??
		preferredDefaultModel(availableModels);
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
