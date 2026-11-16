import type { Model } from "@earendil-works/pi-ai";
import { applyEdits, modify } from "jsonc-parser";
import {
	MODELS_JSON_FORMATTING,
	modelsPath,
	parseModelsConfig,
	publishModelsFileChange,
	readModelsSource,
	serializeModelsWrite,
	splitModelsSource,
	writeModelsFile,
} from "./modelsFile";

interface RefreshableRuntime {
	refresh(options: { allowNetwork: false }): Promise<unknown>;
}

export function declaresServerFallback(model: Model<string>): boolean {
	if (model.api !== "anthropic-messages") return false;
	return ((model as Model<"anthropic-messages">).compat?.allowedFallbackModels?.length ?? 0) > 0;
}

export function disableProviderFallback(
	provider: string,
	runtimes: readonly RefreshableRuntime[],
): Promise<void> {
	return serializeModelsWrite(async () => {
		const path = modelsPath();
		const source = readModelsSource(path);
		parseModelsConfig(source);
		const { bom, body } = splitModelsSource(source);
		const next =
			bom +
			applyEdits(
				body,
				modify(
					body,
					["providers", provider, "compat", "allowedFallbackModels"],
					[],
					MODELS_JSON_FORMATTING,
				),
			);
		const changed = next !== source;
		if (changed) writeModelsFile(path, next);
		for (const runtime of new Set(runtimes)) await runtime.refresh({ allowNetwork: false });
		if (changed) publishModelsFileChange();
	});
}
