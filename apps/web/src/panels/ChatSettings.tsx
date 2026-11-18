import {
	type ComposerGrowthLimit,
	DEFAULT_CONFIG,
	QUESTION_PANEL_HEIGHT_PERCENT,
	QUESTION_PANEL_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { type ChatMessageOrder, DEFAULT_CHAT_MESSAGE_ORDER } from "@/chat/chatPreferences";
import {
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsGroup,
	SettingsNumberField,
	SettingsPage,
	SettingsRow,
} from "@/settingsKit";
import { useAppStore } from "@/store";
import { saveSettings } from "./saveSettings";
import { isClientPreferenceDefault, isConfigDefault } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

type OptionSpec<T extends string> = SettingsChoiceOption<T> & { label: MessageKey };

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

export function QuestionPanelHeightControl({
	protocolVersion,
	value,
	onCommit,
}: {
	protocolVersion: number | null;
	value: number;
	onCommit: (height: number) => Promise<boolean>;
}) {
	const t = useT();
	if (protocolVersion === null || protocolVersion < QUESTION_PANEL_PROTOCOL_VERSION) return null;
	return (
		<SettingsRow
			{...settingProps(t, SETTING.questionPanelHeight)}
			control={
				<SettingsNumberField
					label={t("settings.chat.questionPanelHeightInput")}
					value={value}
					min={QUESTION_PANEL_HEIGHT_PERCENT.min}
					max={QUESTION_PANEL_HEIGHT_PERCENT.max}
					unit={t("settings.chat.questionPanelHeightUnit")}
					testId="question-panel-height-input"
					onCommit={onCommit}
				/>
			}
			reset={{
				changed: !isConfigDefault("questionPanelHeight", value),
				onReset: () => void onCommit(DEFAULT_CONFIG.questionPanelHeight),
			}}
		/>
	);
}

export interface ChatPageProps {
	messageOrder: ChatMessageOrder;
	growthLimit: ComposerGrowthLimit;
	panelHeight: number;
	protocolVersion: number | null;
	onMessageOrder: (order: ChatMessageOrder) => void;
	onGrowthLimit: (limit: ComposerGrowthLimit) => void;
	onPanelHeight: (height: number) => Promise<boolean>;
}

export function ChatPage({
	messageOrder,
	growthLimit,
	panelHeight,
	protocolVersion,
	onMessageOrder,
	onGrowthLimit,
	onPanelHeight,
}: ChatPageProps) {
	const t = useT();
	return (
		<SettingsPage
			title={t("settings.nav.chat")}
			description={t("settings.chat.description")}
			testId="settings-chat"
		>
			<SettingsGroup title={t("settings.chat.messagesGroup")}>
				<SettingsRow
					{...settingProps(t, SETTING.messageOrder)}
					control={
						<SettingsChoice
							label={t("settings.chat.messageOrder")}
							options={MESSAGE_ORDER_OPTIONS.map((option) => ({
								...option,
								label: t(option.label),
							}))}
							value={messageOrder}
							cost="cheap"
							onSelect={onMessageOrder}
							testId="chat-message-order-control"
						/>
					}
					reset={{
						changed: !isClientPreferenceDefault("chatMessageOrder", messageOrder),
						onReset: () => onMessageOrder(DEFAULT_CHAT_MESSAGE_ORDER),
					}}
				/>
				<SettingsRow
					{...settingProps(t, SETTING.composerSize)}
					control={
						<SettingsChoice
							label={t("settings.chat.composerSize")}
							options={GROWTH_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
							value={growthLimit}
							cost="cheap"
							onSelect={onGrowthLimit}
							testId="composer-growth-control"
						/>
					}
					reset={{
						changed: !isConfigDefault("composerGrowthLimit", growthLimit),
						onReset: () => onGrowthLimit(DEFAULT_CONFIG.composerGrowthLimit),
					}}
				/>
				<QuestionPanelHeightControl
					protocolVersion={protocolVersion}
					value={panelHeight}
					onCommit={onPanelHeight}
				/>
			</SettingsGroup>
		</SettingsPage>
	);
}

export function ChatSettings() {
	const t = useT();
	const messageOrder = useAppStore((state) => state.chatMessageOrder);
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);
	const panelHeight = useAppStore((state) => state.questionPanelHeight);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const setChatMessageOrder = useAppStore((state) => state.setChatMessageOrder);

	return (
		<ChatPage
			messageOrder={messageOrder}
			growthLimit={growthLimit}
			panelHeight={panelHeight}
			protocolVersion={protocolVersion}
			onMessageOrder={(order) => {
				if (order !== messageOrder) setChatMessageOrder(order);
			}}
			onGrowthLimit={(composerGrowthLimit) => {
				if (composerGrowthLimit === growthLimit) return;
				void saveSettings({ composerGrowthLimit }, t("settings.chat.growthFailed"));
			}}
			onPanelHeight={(questionPanelHeight) =>
				saveSettings({ questionPanelHeight }, t("settings.chat.questionPanelHeightFailed"))
			}
		/>
	);
}
