import { type ModelDefault, THINKING_LEVELS, type ThinkingLevel } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { ThinkingSelector } from "@/chat/ThinkingSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { Button } from "@/components/ui/button";
import { toast } from "@/store";
import { getTransport } from "@/transport";

export function ModelsSettings() {
	const { models, refreshing, refresh } = useModelCatalog(true);
	const [state, setState] = useState<ModelDefault | null>(null);
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
			setState(next);
			setLoadFailed(false);
		} catch {
			if (seq === readSeq.current) setLoadFailed(true);
		} finally {
			if (seq === readSeq.current) setReading(false);
		}
	}, []);

	useEffect(() => {
		void readDefault();
	}, [models, readDefault]);

	const saveDefault = async (
		params: { model: { provider: string; id: string } } | { thinkingLevel: ThinkingLevel },
		message: string,
	) => {
		if (saving || reading) return;
		setSaving(true);
		try {
			await getTransport().request("model.setDefault", params);
		} catch {
			toast.error(message);
		}
		await readDefault();
		setSaving(false);
	};

	const setDefaultModel = (model: { provider: string; id: string }) => {
		void saveDefault({ model }, "Couldn't save the default model");
	};

	const setDefaultThinkingLevel = (thinkingLevel: ThinkingLevel) => {
		void saveDefault({ thinkingLevel }, "Couldn't save the default effort");
	};

	return (
		<section data-testid="settings-models" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Default model</h3>
				<p className="text-text-muted tr-text-metadata">
					The model and effort new chats start with. Saved in Pi's settings, so the pi terminal app
					uses it too. A project's .pi/settings.json can override it.
				</p>
			</div>
			{loadFailed ? (
				<div className="flex items-center gap-8">
					<p className="text-text-muted tr-text-ui">Couldn't load your default model.</p>
					<Button variant="ghost" size="sm" onClick={() => void readDefault()}>
						Retry
					</Button>
				</div>
			) : state ? (
				<div className="flex flex-wrap items-center gap-8">
					<ModelSelector
						models={models}
						current={state.model}
						refreshing={refreshing}
						onRefresh={refresh}
						onSelect={setDefaultModel}
						placeholder="Pi chooses automatically"
						disabled={saving || reading}
					/>
					<ThinkingSelector
						level={state.model ? state.thinkingLevel : state.defaultThinkingLevel}
						levels={state.model?.thinkingLevels ?? THINKING_LEVELS}
						onSelect={setDefaultThinkingLevel}
						disabled={saving || reading}
					/>
				</div>
			) : null}
		</section>
	);
}
