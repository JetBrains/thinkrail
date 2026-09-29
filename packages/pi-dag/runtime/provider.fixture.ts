import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const model = { provider: "dag-faux", id: "worker" };
export const faux = createFauxCore({
	provider: model.provider,
	api: "dag-faux",
	tokensPerSecond: 100_000,
});

export async function createTestRuntime(prompts?: string[]): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider(model.provider, {
		api: faux.api,
		baseUrl: "http://faux.local",
		apiKey: "synthetic",
		streamSimple: (model, context, options) => {
			prompts?.push(JSON.stringify(context.messages));
			return faux.streamSimple(model, context, options);
		},
		models: [
			{
				id: model.id,
				name: "Worker",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
	});
	return runtime;
}
