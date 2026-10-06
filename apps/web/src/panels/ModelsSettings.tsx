import type { ModelDefault, ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { ThinkingSelector } from "@/chat/ThinkingSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { selectCatalogModel, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ModelContextSettings } from "./ModelContextSettings";

export function ModelsSettings() {
	const defaultModel = useAppStore((s) => s.defaultModel);
	const defaultEffort = useAppStore((s) => s.defaultEffort);
	const { models, refreshing, refresh } = useModelCatalog(true);
	const [resolvedDefault, setResolvedDefault] = useState<ModelDefault | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [saving, setSaving] = useState(false);
	const [reading, setReading] = useState(true);
	const readSeq = useRef(0);

	const readDefault = useCallback(async () => {
		const seq = ++readSeq.current;
		setReading(true);
		try {
			const next = await getTransport().request("model.default", {});
			if (seq !== readSeq.current) return;
			setResolvedDefault(next);
			setLoadFailed(false);
		} catch {
			if (seq === readSeq.current) setLoadFailed(true);
		} finally {
			if (seq === readSeq.current) setReading(false);
		}
	}, []);

	useEffect(() => {
		void readDefault();
	}, [models, defaultModel, defaultEffort, readDefault]);

	const saveConfig = async (
		config: { defaultModel?: WireModel | null; defaultEffort?: ThinkingLevel | null },
		message: string,
	) => {
		if (saving || reading) return;
		setSaving(true);
		try {
			await getTransport().request("settings.update", { config });
			await readDefault();
		} catch {
			toast.error(message);
		} finally {
			setSaving(false);
		}
	};

	const configuredModel = selectCatalogModel(models, defaultModel ?? null);
	const model = resolvedDefault ? resolvedDefault.model : configuredModel;
	const level = resolvedDefault?.thinkingLevel ?? defaultEffort ?? "medium";

	return (
		<section data-testid="settings-models" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Default model</h3>
				<p className="text-text-muted tr-text-metadata">
					The model and effort new chats start with. If it's unavailable, new chats use the first
					available model.
				</p>
			</div>
			{loadFailed ? (
				<div className="flex items-center gap-8">
					<p className="text-text-muted tr-text-ui">Couldn't load your default model.</p>
					<Button variant="ghost" size="sm" onClick={() => void readDefault()}>
						Retry
					</Button>
				</div>
			) : resolvedDefault || !reading ? (
				<div className="flex flex-wrap items-center gap-8">
					<ModelSelector
						models={models}
						current={model}
						refreshing={refreshing}
						onRefresh={refresh}
						onSelect={(selected) =>
							void saveConfig({ defaultModel: selected }, "Couldn't save the default model")
						}
						placeholder="First available model"
						disabled={saving || reading}
					/>
					<ThinkingSelector
						level={level}
						levels={model?.thinkingLevels ?? []}
						onSelect={(defaultEffort) =>
							void saveConfig({ defaultEffort }, "Couldn't save the default effort")
						}
						disabled={saving || reading}
					/>
				</div>
			) : null}
			<ModelContextSettings />
		</section>
	);
}
