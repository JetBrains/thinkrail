import type { WireModel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { useMemo, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { useModelPreferences } from "@/chat/useModelPreferences";
import { SettingsSection, selectCatalogModel, selectPickerModels, useAppStore } from "@/store";
import { startWikiBuild } from "./wikiActions";
import {
	readBuildPreference,
	type WikiBuildPreference,
	writeBuildPreference,
} from "./wikiPageState";

export function WikiBuildPanel({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const { models, refreshing, refresh } = useModelCatalog(true);
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const defaultModel = useAppStore((s) => s.defaultModel);
	const [preference, setPreference] = useState<WikiBuildPreference>(readBuildPreference);
	const [starting, setStarting] = useState(false);

	const selectedRef = selectCatalogModel(models, preference.model)
		? preference.model
		: (defaultModel ?? null);
	const visible = useMemo(
		() => selectPickerModels(models, hiddenModels, [selectedRef]),
		[models, hiddenModels, selectedRef],
	);
	const preferences = useModelPreferences(visible);
	const model: WireModel | null = selectCatalogModel(models, selectedRef) ?? visible[0] ?? null;

	const update = (next: WikiBuildPreference) => {
		setPreference(next);
		writeBuildPreference(next);
	};

	const start = () => {
		if (!model || starting) return;
		setStarting(true);
		void startWikiBuild(workspaceId, model, preference.codeOnly).finally(() => setStarting(false));
	};

	return (
		<section
			data-testid="wiki-build-panel"
			className="flex flex-col gap-12 border-border-default border-b px-16 py-12"
		>
			<div className="flex flex-col gap-2">
				<h2 className="tr-text-emphasis text-text-default">{t("panels.wiki.build.title")}</h2>
				<p className="tr-text-metadata text-text-muted">{t("panels.wiki.build.description")}</p>
			</div>
			<div className="flex flex-wrap items-center gap-8">
				<span className="tr-text-ui text-text-default">{t("panels.wiki.build.model")}</span>
				<ModelSelector
					models={visible}
					current={model}
					refreshing={refreshing}
					onRefresh={refresh}
					onSelect={(selected) =>
						update({ ...preference, model: { provider: selected.provider, id: selected.id } })
					}
					placeholder={t("panels.wiki.build.modelPlaceholder")}
					preferences={preferences}
				/>
				{model ? (
					<span data-testid="wiki-build-endpoint" className="tr-text-metadata text-text-muted">
						{t("panels.wiki.build.endpoint", { endpoint: model.provider })}
					</span>
				) : null}
				<Button
					variant="ghost"
					size="s"
					onClick={() => useAppStore.getState().openSettings(SettingsSection.Providers)}
				>
					{t("panels.wiki.build.manageEndpoints")}
				</Button>
			</div>
			<div className="flex items-center gap-8">
				<Switch
					checked={preference.codeOnly}
					label={t("panels.wiki.build.codeOnly")}
					testId="wiki-code-only"
					onCheckedChange={(codeOnly) => update({ ...preference, codeOnly })}
				/>
				<span className="flex flex-col">
					<span className="tr-text-ui text-text-default">{t("panels.wiki.build.codeOnly")}</span>
					<span className="tr-text-metadata text-text-muted">
						{t("panels.wiki.build.codeOnlyHint")}
					</span>
				</span>
			</div>
			<div>
				<Button
					variant="primary"
					data-testid="wiki-build-start"
					disabled={model === null || starting}
					loading={starting}
					onClick={start}
				>
					{t("panels.wiki.build.start")}
				</Button>
			</div>
		</section>
	);
}
