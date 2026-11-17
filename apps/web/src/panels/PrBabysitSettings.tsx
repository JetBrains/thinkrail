import type { IndependentReviewMode, PrBabysitConfig, PrBabysitMode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { useModelPreferences } from "@/chat/useModelPreferences";
import { selectPickerModels, selectPrBabysitSupported, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRadioCards } from "./SettingsRadioCards";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { useSettingsDialogContainer } from "./settingsDialogContainer";

const CYCLE_CHOICES = ["1", "3", "5", "10", "20"] as const;
type CycleChoice = (typeof CYCLE_CHOICES)[number];

function cycleChoice(value: number): CycleChoice | null {
	return CYCLE_CHOICES.find((choice) => Number(choice) === value) ?? null;
}

/** Settings → Integrations: the PR Babysit & Independent Review defaults (`AppConfig.prBabysit`). */
export function PrBabysitSettings() {
	const t = useT();
	const supported = useAppStore(selectPrBabysitSupported);
	const config = useAppStore((s) => s.prBabysitConfig);
	const reviewModel = useAppStore((s) => s.reviewModel);
	const container = useSettingsDialogContainer();
	const { models, refreshing, refresh } = useModelCatalog(true);
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const visible = useMemo(
		() => selectPickerModels(models, hiddenModels, []),
		[models, hiddenModels],
	);
	const preferences = useModelPreferences(visible);

	if (!supported) return null;

	const save = (prBabysit: Partial<PrBabysitConfig>) => {
		getTransport()
			.request("settings.update", { config: { prBabysit } })
			.catch(() => toast.error(t("settings.prBabysit.saveFailed")));
	};

	const reviewerDefault = reviewModel?.name ?? t("settings.prBabysit.reviewerDefault");

	return (
		<div data-testid="settings-pr-babysit" className="flex flex-col gap-24">
			<SettingsGroup
				title={t("settings.prBabysit.title")}
				description={t("settings.prBabysit.description")}
			>
				<SettingsRow
					testId="pr-babysit-model-row"
					label={t("settings.prBabysit.babysitModel")}
					description={t("settings.prBabysit.babysitModelDescription")}
					control={
						<ModelSelector
							models={selectPickerModels(models, hiddenModels, [config.babysitModel])}
							current={config.babysitModel}
							refreshing={refreshing}
							onRefresh={refresh}
							onSelect={(model) => save({ babysitModel: model })}
							placeholder={t("settings.prBabysit.defaultModel")}
							defaultOption={t("settings.prBabysit.defaultModel")}
							onSelectDefault={() => save({ babysitModel: null })}
							preferences={preferences}
							container={container}
						/>
					}
				/>
				<SettingsRow
					testId="pr-reviewer-model-row"
					label={t("settings.prBabysit.reviewerModel")}
					description={t("settings.prBabysit.reviewerModelDescription")}
					control={
						<ModelSelector
							models={selectPickerModels(models, hiddenModels, [config.reviewerModel])}
							current={config.reviewerModel}
							refreshing={refreshing}
							onRefresh={refresh}
							onSelect={(model) => save({ reviewerModel: model })}
							placeholder={reviewerDefault}
							defaultOption={reviewerDefault}
							onSelectDefault={() => save({ reviewerModel: null })}
							preferences={preferences}
							container={container}
						/>
					}
				/>
			</SettingsGroup>

			<SettingsGroup title={t("settings.prBabysit.reviewTitle")}>
				<SettingsRadioCards<IndependentReviewMode>
					name="pr-babysit-review-mode"
					label={t("settings.prBabysit.reviewTitle")}
					value={config.independentReviewMode}
					onSelect={(independentReviewMode) => save({ independentReviewMode })}
					choices={[
						{
							id: "review_and_auto_queue",
							label: t("settings.prBabysit.review.autoQueue"),
							description: t("settings.prBabysit.review.autoQueueDescription"),
							testId: "pr-review-mode-auto-queue",
						},
						{
							id: "review_for_approval",
							label: t("settings.prBabysit.review.approval"),
							description: t("settings.prBabysit.review.approvalDescription"),
							testId: "pr-review-mode-approval",
						},
						{
							id: "post_to_github",
							label: t("settings.prBabysit.review.post"),
							description: t("settings.prBabysit.review.postDescription"),
							testId: "pr-review-mode-post",
						},
						{
							id: "off",
							label: t("settings.prBabysit.review.off"),
							description: t("settings.prBabysit.review.offDescription"),
							testId: "pr-review-mode-off",
						},
					]}
				/>
			</SettingsGroup>

			<SettingsGroup title={t("settings.prBabysit.modeTitle")}>
				<SettingsRadioCards<PrBabysitMode>
					name="pr-babysit-mode"
					label={t("settings.prBabysit.modeTitle")}
					value={config.mode}
					onSelect={(mode) => save({ mode })}
					choices={[
						{
							id: "auto_push",
							label: t("settings.prBabysit.mode.auto"),
							description: t("settings.prBabysit.mode.autoDescription"),
							testId: "pr-babysit-mode-auto",
						},
						{
							id: "stage_for_approval",
							label: t("settings.prBabysit.mode.stage"),
							description: t("settings.prBabysit.mode.stageDescription"),
							testId: "pr-babysit-mode-stage",
						},
					]}
				/>
			</SettingsGroup>

			<SettingsGroup title={t("settings.prBabysit.threadsTitle")}>
				<SettingsRow
					testId="pr-babysit-auto-resolve-row"
					label={t("settings.prBabysit.autoResolve")}
					description={t("settings.prBabysit.autoResolveDescription")}
					control={
						<SettingsSwitch
							checked={config.autoResolveThreads}
							label={t("settings.prBabysit.autoResolve")}
							testId="pr-babysit-auto-resolve"
							onChange={(autoResolveThreads) => save({ autoResolveThreads })}
						/>
					}
				/>
				<SettingsRow
					testId="pr-babysit-fix-ci-row"
					label={t("settings.prBabysit.fixCi")}
					description={t("settings.prBabysit.fixCiDescription")}
					control={
						<SettingsSwitch
							checked={config.fixFailingChecks}
							label={t("settings.prBabysit.fixCi")}
							testId="pr-babysit-fix-ci"
							onChange={(fixFailingChecks) => save({ fixFailingChecks })}
						/>
					}
				/>
				<SettingsRow
					testId="pr-babysit-max-cycles-row"
					label={t("settings.prBabysit.maxCycles")}
					description={t("settings.prBabysit.maxCyclesDescription")}
					control={
						<SegmentedControl<CycleChoice>
							name="pr-babysit-max-cycles"
							label={t("settings.prBabysit.maxCycles")}
							testId="pr-babysit-max-cycles"
							value={cycleChoice(config.maxPushCycles)}
							onSelect={(choice) => save({ maxPushCycles: Number(choice) })}
							options={CYCLE_CHOICES.map((choice) => ({ id: choice, label: choice }))}
						/>
					}
				/>
			</SettingsGroup>
		</div>
	);
}
