import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	type AppConfigUpdate,
	type ModelDefault,
	REVIEW_AUTO_FIX_ROUNDS,
	REVIEW_FIX_ROUNDS_SETTING_PROTOCOL_VERSION,
	type ThinkingLevel,
	type WireModel,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DefaultPairOption, ModelEffortPicker } from "@/chat/ModelEffortPicker";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { useModelPreferences } from "@/chat/useModelPreferences";
import {
	SettingsGroup,
	SettingsNumberField,
	SettingsPage,
	SettingsRow,
	useSettingsDialogContainer,
} from "@/settingsKit";
import { selectCatalogModel, selectPickerModels, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { CacheWarmingSettings } from "./CacheWarmingSettings";
import { useCustomEndpoints } from "./CustomEndpointsSettings";
import { ModelContextSettings } from "./ModelContextSettings";
import { saveSettings } from "./saveSettings";
import { configResetPatch, isConfigDefault, useConfigReset } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";
import { VisibleModelsSettings } from "./VisibleModelsSettings";

interface ModelPair {
	model: WireModel | null;
	level: ThinkingLevel;
}

export const CHAT_PAIR_RESET: AppConfigUpdate = {
	...configResetPatch("defaultModel"),
	...configResetPatch("defaultEffort"),
};

export const REVIEW_PAIR_RESET: AppConfigUpdate = {
	...configResetPatch("reviewModel"),
	...configResetPatch("reviewEffort"),
};

function useDefaultPair(models: readonly WireModel[]) {
	const defaultModel = useAppStore((s) => s.defaultModel);
	const defaultEffort = useAppStore((s) => s.defaultEffort);
	const [resolved, setResolved] = useState<ModelDefault | null>(null);
	const [failed, setFailed] = useState(false);
	const [optimistic, setOptimistic] = useState<ModelPair | null>(null);
	const reads = useRef(0);
	const saves = useRef({ seq: 0, queue: Promise.resolve() });

	const read = useCallback(async () => {
		const seq = ++reads.current;
		const next = await getTransport()
			.request("model.default", {})
			.catch(() => null);
		if (seq !== reads.current) return;
		if (next) setResolved(next);
		setFailed(next === null);
	}, []);

	useEffect(() => {
		void read();
	}, [models, defaultModel, defaultEffort, read]);

	const save = (config: AppConfigUpdate, next: ModelPair | null, failure: string) => {
		const seq = ++saves.current.seq;
		setOptimistic(next);
		saves.current.queue = saves.current.queue.then(async () => {
			await saveSettings(config, failure);
			if (seq !== saves.current.seq) return;
			await read();
			if (seq === saves.current.seq) setOptimistic(null);
		});
	};

	const configured = selectCatalogModel(models, defaultModel ?? null);
	const pair: ModelPair = optimistic ?? {
		model: resolved ? resolved.model : configured,
		level: resolved?.thinkingLevel ?? defaultEffort ?? "medium",
	};
	return {
		pair,
		resolved,
		ready: resolved !== null,
		failed,
		retry: () => void read(),
		save,
		changed:
			!isConfigDefault("defaultModel", defaultModel) ||
			!isConfigDefault("defaultEffort", defaultEffort),
	};
}

export function ModelsSettings() {
	const t = useT();
	const container = useSettingsDialogContainer();
	const reviewModel = useAppStore((s) => s.reviewModel);
	const reviewEffort = useAppStore((s) => s.reviewEffort);
	const autoFix = useAppStore((s) => s.reviewAutoFix);
	const autoFixRounds = useAppStore((s) => s.reviewAutoFixRounds);
	const agentReviewEnabled = useAppStore((s) => s.agentReviewEnabled);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const { models: allModels, refreshing, refresh } = useModelCatalog(true);
	const visibleModels = useMemo(
		() => selectPickerModels(allModels, hiddenModels, []),
		[allModels, hiddenModels],
	);
	const preferences = useModelPreferences(visibleModels);
	const customEndpoints = useCustomEndpoints();
	const chat = useDefaultPair(allModels);
	const agentReviewReset = useConfigReset(
		"agentReviewEnabled",
		"settings.models.agentReviewFailed",
	);
	const autoFixReset = useConfigReset("reviewAutoFix", "settings.models.autoFixFailed");
	const autoFixRoundsReset = useConfigReset(
		"reviewAutoFixRounds",
		"settings.models.autoFixRoundsFailed",
	);

	const { model: chatModel, level: chatLevel } = chat.pair;
	const reviewCurrent = reviewModel
		? (selectCatalogModel(allModels, reviewModel) ?? reviewModel)
		: chatModel;
	const reviewLevel = reviewEffort ?? chat.resolved?.thinkingLevel ?? chatLevel;
	const followsDefault = !reviewModel && !reviewEffort;

	const saveReview = (config: AppConfigUpdate) =>
		void saveSettings(config, t("settings.models.reviewModelFailed"));

	const reviewDefault: DefaultPairOption = {
		resolved: chat.resolved,
		active: followsDefault,
		onSelect: () => saveReview(REVIEW_PAIR_RESET),
	};

	const pickerProps = {
		refreshing,
		onRefresh: refresh,
		preferences,
		container,
		fitContainer: true,
		canSetDefault: false,
		tabIndex: 0,
		className: "max-w-full",
	} as const;

	return (
		<SettingsPage
			title={t("settings.nav.models")}
			description={t("settings.models.description")}
			testId="settings-models"
		>
			<SettingsGroup title={t("settings.models.defaultGroup")}>
				<SettingsRow
					{...settingProps(t, SETTING.chatModel)}
					{...(chat.failed ? { description: t("settings.models.loadFailed") } : {})}
					testId="default-model-row"
					control={
						chat.failed ? (
							<Button
								variant="outline"
								size="m"
								tabIndex={0}
								data-testid="default-model-retry"
								onClick={chat.retry}
							>
								{t("common.retry")}
							</Button>
						) : chat.ready ? (
							<ModelEffortPicker
								{...pickerProps}
								models={selectPickerModels(allModels, hiddenModels, [chatModel])}
								current={chatModel}
								level={chatLevel}
								onSelect={({ model, level }) =>
									chat.save(
										{ defaultModel: model, ...(level ? { defaultEffort: level } : {}) },
										{ model, level: level ?? chatLevel },
										t("settings.models.saveModelFailed"),
									)
								}
								onSelectLevel={(level) =>
									chat.save(
										{ defaultEffort: level },
										{ model: chatModel, level },
										t("settings.models.saveEffortFailed"),
									)
								}
							/>
						) : null
					}
					reset={{
						changed: chat.changed,
						onReset: () => chat.save(CHAT_PAIR_RESET, null, t("settings.models.saveModelFailed")),
					}}
				/>
			</SettingsGroup>

			<SettingsGroup title={t("settings.models.reviewGroup")} testId="models-review-group">
				<SettingsRow
					{...settingProps(t, SETTING.reviewModel)}
					testId="review-model-row"
					control={
						<ModelEffortPicker
							{...pickerProps}
							models={selectPickerModels(allModels, hiddenModels, [reviewCurrent])}
							current={reviewCurrent}
							level={reviewLevel}
							defaultOption={reviewDefault}
							onSelect={({ model, level }) =>
								saveReview({ reviewModel: model, ...(level ? { reviewEffort: level } : {}) })
							}
							onSelectLevel={(level) => saveReview({ reviewEffort: level })}
						/>
					}
					reset={{ changed: !followsDefault, onReset: () => saveReview(REVIEW_PAIR_RESET) }}
				/>
				{protocolVersion !== null && protocolVersion >= AGENT_REVIEW_SETTING_PROTOCOL_VERSION ? (
					<SettingsRow
						{...settingProps(t, SETTING.agentReview)}
						testId="agent-review-row"
						control={
							<Switch
								checked={agentReviewEnabled}
								label={t("settings.models.agentReview")}
								testId="agent-review-toggle"
								tabIndex={0}
								onCheckedChange={(value) =>
									void saveSettings(
										{ agentReviewEnabled: value },
										t("settings.models.agentReviewFailed"),
									)
								}
							/>
						}
						reset={agentReviewReset}
					/>
				) : null}
				<SettingsRow
					{...settingProps(t, SETTING.autoFix)}
					testId="review-autofix-row"
					control={
						<Switch
							checked={autoFix}
							label={t("settings.models.autoFix")}
							testId="review-autofix-toggle"
							tabIndex={0}
							onCheckedChange={(reviewAutoFix) =>
								void saveSettings({ reviewAutoFix }, t("settings.models.autoFixFailed"))
							}
						/>
					}
					reset={autoFixReset}
				/>
				{protocolVersion !== null &&
				protocolVersion >= REVIEW_FIX_ROUNDS_SETTING_PROTOCOL_VERSION ? (
					<SettingsRow
						{...settingProps(t, SETTING.autoFixRounds)}
						testId="review-autofix-rounds-row"
						control={
							<SettingsNumberField
								label={t("settings.models.autoFixRounds")}
								value={autoFixRounds}
								min={REVIEW_AUTO_FIX_ROUNDS.min}
								max={REVIEW_AUTO_FIX_ROUNDS.max}
								disabled={!autoFix}
								testId="review-autofix-rounds-input"
								onCommit={(reviewAutoFixRounds) =>
									saveSettings({ reviewAutoFixRounds }, t("settings.models.autoFixRoundsFailed"))
								}
							/>
						}
						reset={autoFixRoundsReset}
					/>
				) : null}
			</SettingsGroup>

			<ModelContextSettings customEndpoints={customEndpoints} />

			<CacheWarmingSettings />

			<VisibleModelsSettings models={allModels} />
		</SettingsPage>
	);
}
