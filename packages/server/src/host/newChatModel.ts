import {
	type AppConfig,
	sameModel,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import { clampThinkingForModel, listSettledModels, preferredDefaultModel } from "../agent";
import { getConfig, noteRecentModel } from "../settings";
import { trackChatStarted } from "./authAnalytics";

export type NewChatModelRequest = { model?: WireModel; thinkingLevel?: ThinkingLevel };
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
		availableModels.find((candidate) => sameModel(candidate, savedModel)) ??
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

/** A new chat's bookkeeping: an explicit pick becomes recent, and analytics hear the model the chat got. */
export function noteNewChat(
	requested: NewChatModelRequest,
	resolved: { model: WireModel | null },
	created: { sessionId: string; model: WireModel | null },
): void {
	if (requested.model && created.model) noteRecentModel(created.model);
	trackChatStarted({ sessionId: created.sessionId, model: resolved.model ? created.model : null });
}
