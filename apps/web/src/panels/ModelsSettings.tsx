import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	type ModelDefault,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { ThinkingSelector } from "@/chat/ThinkingSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { useModelPreferences } from "@/chat/useModelPreferences";
import { selectCatalogModel, selectPickerModels, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { ModelContextSettings } from "./ModelContextSettings";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { VisibleModelsSettings } from "./VisibleModelsSettings";

export function ModelsSettings() {
	const defaultModel = useAppStore((s) => s.defaultModel);
	const defaultEffort = useAppStore((s) => s.defaultEffort);
	const reviewModel = useAppStore((s) => s.reviewModel);
	const reviewEffort = useAppStore((s) => s.reviewEffort);
	const autoFix = useAppStore((s) => s.reviewAutoFix);
	const agentReviewEnabled = useAppStore((s) => s.agentReviewEnabled);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const { models: allModels, refreshing, refresh } = useModelCatalog(true);
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const visibleModels = useMemo(
		() => selectPickerModels(allModels, hiddenModels, []),
		[allModels, hiddenModels],
	);
	const preferences = useModelPreferences(visibleModels);
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
	}, [allModels, defaultModel, defaultEffort, readDefault]);

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

	const configuredModel = selectCatalogModel(allModels, defaultModel ?? null);
	const model = resolvedDefault ? resolvedDefault.model : configuredModel;
	const level = resolvedDefault?.thinkingLevel ?? defaultEffort ?? "medium";
	const chatPickerModels = selectPickerModels(allModels, hiddenModels, [model]);
	const reviewPickerModels = selectPickerModels(allModels, hiddenModels, [reviewModel]);

	const reviewerEffortModel = reviewModel ?? resolvedDefault?.model ?? null;
	const reviewerEffortLevel =
		reviewEffort ?? (reviewModel ? "medium" : (resolvedDefault?.thinkingLevel ?? "medium"));
	const reviewerPlaceholder = resolvedDefault?.model
		? `${resolvedDefault.model.name} (Default)`
		: "Default model";

	const updateReviewer = (config: {
		reviewModel?: WireModel | null;
		reviewEffort?: ThinkingLevel | null;
	}) => {
		getTransport()
			.request("settings.update", { config })
			.catch(() => toast.error("Couldn't change the review model"));
	};

	const setAutoFix = (reviewAutoFix: boolean) => {
		getTransport()
			.request("settings.update", { config: { reviewAutoFix } })
			.catch(() => toast.error("Couldn't change the auto-fix setting"));
	};

	const setAgentReviewEnabled = (value: boolean) => {
		getTransport()
			.request("settings.update", { config: { agentReviewEnabled: value } })
			.catch(() => toast.error("Couldn't change the agent-review setting"));
	};

	return (
		<SettingsPageContainer testId="settings-models">
			<SettingsGroup title="Default models">
				{loadFailed ? (
					<div className="flex items-center gap-8 border-border-muted border-b py-12">
						<p className="text-text-muted tr-text-ui">Couldn't load your default model.</p>
						<Button variant="ghost" size="sm" onClick={() => void readDefault()}>
							Retry
						</Button>
					</div>
				) : resolvedDefault || !reading ? (
					<div
						data-testid="default-model-row"
						className="flex flex-wrap items-center justify-between gap-12 border-border-muted border-b py-12"
					>
						<span className="tr-text-ui text-text-default">Chat model</span>
						<div className="flex flex-wrap items-center gap-8">
							<ModelSelector
								models={chatPickerModels}
								current={model}
								refreshing={refreshing}
								onRefresh={refresh}
								onSelect={(selected) =>
									void saveConfig({ defaultModel: selected }, "Couldn't save the default model")
								}
								placeholder="First available"
								disabled={saving || reading}
								preferences={preferences}
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
					</div>
				) : null}
				<div
					data-testid="review-model-row"
					className="flex flex-wrap items-center justify-between gap-12 border-border-muted border-b py-12"
				>
					<span className="tr-text-ui text-text-default">Review model</span>
					<div className="flex flex-wrap items-center gap-8">
						<ModelSelector
							models={reviewPickerModels}
							current={reviewModel ?? null}
							refreshing={refreshing}
							onRefresh={refresh}
							onSelect={(m) => updateReviewer({ reviewModel: m })}
							placeholder={reviewerPlaceholder}
							defaultOption={reviewerPlaceholder}
							onSelectDefault={() => updateReviewer({ reviewModel: null, reviewEffort: null })}
							preferences={preferences}
						/>
						<ThinkingSelector
							level={reviewerEffortLevel}
							levels={reviewerEffortModel?.thinkingLevels ?? []}
							onSelect={(level) => updateReviewer({ reviewEffort: level })}
						/>
					</div>
				</div>
				<VisibleModelsSettings models={allModels} />
			</SettingsGroup>

			<SettingsGroup title="Automation">
				{protocolVersion !== null && protocolVersion >= AGENT_REVIEW_SETTING_PROTOCOL_VERSION && (
					<SettingsRow
						testId="agent-review-row"
						label="Agent-triggered review"
						description="Allow the agent to review completed work."
						control={
							<SettingsSwitch
								checked={agentReviewEnabled}
								label="Agent-triggered review"
								testId="agent-review-toggle"
								onChange={setAgentReviewEnabled}
							/>
						}
					/>
				)}
				<SettingsRow
					testId="review-autofix-row"
					label="Automatic fix cycle"
					description="Send requested changes back to the agent once."
					control={
						<SettingsSwitch
							checked={autoFix}
							label="Automatic fix cycle"
							testId="review-autofix-toggle"
							onChange={setAutoFix}
						/>
					}
				/>
			</SettingsGroup>

			<ModelContextSettings />
		</SettingsPageContainer>
	);
}
