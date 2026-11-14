import type { ChatMessageOrder } from "@thinkrail/chat-ui/chatMessageOrder";
import {
	type ComposerGrowthLimit,
	isQuestionPanelHeight,
	QUESTION_PANEL_HEIGHT_PERCENT,
	QUESTION_PANEL_PROTOCOL_VERSION,
	type SubagentOverride,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import {
	SegmentedControl,
	type SegmentedControlOption,
	SettingsGroup,
	SettingsPageContainer,
	SettingsRow,
} from "@thinkrail/ui/settings";
import { cn } from "@thinkrail/ui/utils";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { LineWidthControl } from "./LineWidthSettings";
import { SubagentSettings } from "./SubagentSettings";
import { saveSettings } from "./saveSettings";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

type OptionSpec<T extends string> = SegmentedControlOption<T> & { label: MessageKey };

const MESSAGE_ORDER_OPTIONS: OptionSpec<ChatMessageOrder>[] = [
	{
		id: "oldest-first",
		label: "settings.chat.order.oldestFirst",
		testId: "chat-order-oldest-first",
	},
	{
		id: "newest-first",
		label: "settings.chat.order.newestFirst",
		testId: "chat-order-newest-first",
	},
];

const GROWTH_OPTIONS: OptionSpec<ComposerGrowthLimit>[] = [
	{ id: "compact", label: "settings.chat.growth.compact", testId: "composer-growth-compact" },
	{ id: "roomy", label: "settings.chat.growth.roomy", testId: "composer-growth-roomy" },
	{ id: "half-chat", label: "settings.chat.growth.halfChat", testId: "composer-growth-half-chat" },
];

function parsedPanelHeight(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isQuestionPanelHeight(value) ? value : null;
}

export function QuestionPanelHeightControl({
	protocolVersion,
	value,
}: {
	protocolVersion: number | null;
	value: number;
}) {
	const t = useT();
	const { invalid, inputProps } = useSettingsDraft({
		saved: String(value),
		isValid: (draft) => parsedPanelHeight(draft) !== null,
		commit: (draft) => {
			const parsed = parsedPanelHeight(draft);
			if (parsed === null || parsed === value) return undefined;
			return saveSettings(
				{ questionPanelHeight: parsed },
				t("settings.chat.questionPanelHeightFailed"),
			);
		},
	});
	const errorId = "question-panel-height-error";
	if (protocolVersion === null || protocolVersion < QUESTION_PANEL_PROTOCOL_VERSION) return null;

	return (
		<SettingsRow
			label={t("settings.chat.questionPanelHeight")}
			description={
				<>
					{t("settings.chat.questionPanelHeightDescription")}
					{invalid ? (
						<span
							id={errorId}
							data-testid={errorId}
							className="block text-feedback-error tr-text-metadata"
						>
							{t("settings.chat.questionPanelHeightInvalid", {
								min: QUESTION_PANEL_HEIGHT_PERCENT.min,
								max: QUESTION_PANEL_HEIGHT_PERCENT.max,
							})}
						</span>
					) : null}
				</>
			}
			control={
				<span className="flex items-center gap-4 text-text-muted tr-text-ui">
					<input
						type="number"
						min={QUESTION_PANEL_HEIGHT_PERCENT.min}
						max={QUESTION_PANEL_HEIGHT_PERCENT.max}
						step={1}
						inputMode="numeric"
						{...inputProps}
						aria-label={t("settings.chat.questionPanelHeightInput")}
						aria-describedby={invalid ? errorId : undefined}
						data-testid="question-panel-height-input"
						className={cn(SETTINGS_INPUT, "w-64")}
					/>
					{t("settings.chat.questionPanelHeightUnit")}
				</span>
			}
		/>
	);
}

export function ChatSettings() {
	const t = useT();
	const messageOrder = useAppStore((state) => state.chatMessageOrder);
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);
	const panelHeight = useAppStore((state) => state.questionPanelHeight);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const subagentsEnabled = useAppStore((state) => state.subagentsEnabled);
	const subagentMaxConcurrent = useAppStore((state) => state.subagentMaxConcurrent);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const setChatMessageOrder = useAppStore((state) => state.setChatMessageOrder);

	const selectMessageOrder = (chatMessageOrder: ChatMessageOrder) => {
		if (chatMessageOrder === messageOrder) return;
		setChatMessageOrder(chatMessageOrder);
	};

	const selectGrowthLimit = (composerGrowthLimit: ComposerGrowthLimit) => {
		if (composerGrowthLimit === growthLimit) return;
		void saveSettings({ composerGrowthLimit }, t("settings.chat.growthFailed"));
	};

	const setWorkspaceSubagents = (override: SubagentOverride | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentsOverride", { id: activeWorkspace.id, override })
			.catch((err: unknown) =>
				toast.error(errorText(err), t("settings.chat.workspaceSubagentsFailed")),
			);
	};

	const setWorkspaceSubagentLimit = (value: number | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentMaxConcurrent", { id: activeWorkspace.id, value })
			.catch((err: unknown) =>
				toast.error(errorText(err), t("settings.chat.workspaceSubagentLimitFailed")),
			);
	};

	return (
		<SettingsPageContainer testId="settings-chat">
			<SettingsGroup title={t("settings.chat.group")}>
				<SettingsRow
					label={t("settings.chat.messageOrder")}
					description={t("settings.chat.messageOrderDescription")}
					control={
						<SegmentedControl
							name="chat-message-order"
							label={t("settings.chat.messageOrder")}
							options={MESSAGE_ORDER_OPTIONS.map((option) => ({
								...option,
								label: t(option.label),
							}))}
							value={messageOrder}
							onSelect={selectMessageOrder}
							testId="chat-message-order-control"
						/>
					}
				/>
				<SettingsRow
					label={t("settings.chat.composerSize")}
					description={t("settings.chat.composerSizeDescription")}
					control={
						<SegmentedControl
							name="composer-growth-limit"
							label={t("settings.chat.composerSize")}
							options={GROWTH_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
							value={growthLimit}
							onSelect={selectGrowthLimit}
							testId="composer-growth-control"
						/>
					}
				/>
				<QuestionPanelHeightControl protocolVersion={protocolVersion} value={panelHeight} />
				<LineWidthControl kind="chat" />
			</SettingsGroup>

			<SubagentSettings
				protocolVersion={protocolVersion}
				globalEnabled={subagentsEnabled}
				globalLimit={subagentMaxConcurrent}
				workspace={activeWorkspace}
				onGlobalEnabledChange={(enabled) =>
					void saveSettings({ subagentsEnabled: enabled }, t("settings.chat.globalSubagentsFailed"))
				}
				onWorkspaceEnabledChange={setWorkspaceSubagents}
				onGlobalLimitChange={(value) =>
					void saveSettings(
						{ subagentMaxConcurrent: value },
						t("settings.chat.subagentLimitFailed"),
					)
				}
				onWorkspaceLimitChange={setWorkspaceSubagentLimit}
			/>
		</SettingsPageContainer>
	);
}
