import type { ComposerGrowthLimit, SubagentOverride } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { T, useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import {
	type ChatMessageOrder,
	moveStreamingResponseHandle,
	STREAMING_RESPONSE_MOVEMENT_LIMITS,
	type StreamingResponseMovement,
} from "@/chat/chatPreferences";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { LineWidthControl } from "./LineWidthSettings";
import { SegmentedControl, type SegmentedControlOption } from "./SegmentedControl";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SETTINGS_RANGE_INPUT, SETTINGS_RANGE_STACKED, SettingsRangeTrack } from "./SettingsRange";
import { SettingsRow } from "./SettingsRow";
import { SubagentSettings } from "./SubagentSettings";
import { saveSettings } from "./saveSettings";

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

const MOVEMENT_TRACK_SEGMENTS = Array.from({ length: 20 }, (_, index) => index * 5);

const MOVEMENT_THUMB = cn(SETTINGS_RANGE_STACKED, SETTINGS_RANGE_INPUT);

function StreamingResponseMovementControl({
	value,
	onChange,
}: {
	value: StreamingResponseMovement;
	onChange: (value: StreamingResponseMovement) => void;
}) {
	const t = useT();
	const update = (handle: "settle" | "trigger", rawValue: string) => {
		onChange(moveStreamingResponseHandle(value, handle, Number(rawValue)));
	};

	return (
		<div
			data-testid="streaming-response-movement"
			className="flex flex-col gap-8 border-border-muted border-b py-12"
		>
			<div className="flex flex-col gap-2">
				<span className="tr-text-ui text-text-default">{t("settings.chat.movement.title")}</span>
				<span className="tr-text-metadata text-text-muted">
					{t("settings.chat.movement.description")}
				</span>
			</div>
			<div className="flex items-center justify-between text-text-muted tr-text-metadata">
				<span>{t("settings.chat.movement.top")}</span>
				<span>{t("settings.chat.movement.messageBox")}</span>
			</div>
			<SettingsRangeTrack
				steps={MOVEMENT_TRACK_SEGMENTS}
				filled={(start) => start >= value.settle && start < value.trigger}
			>
				<input
					type="range"
					data-testid="streaming-movement-settle"
					aria-label={t("settings.chat.movement.settlePosition")}
					aria-valuemin={STREAMING_RESPONSE_MOVEMENT_LIMITS.settleMin}
					aria-valuemax={Math.min(
						STREAMING_RESPONSE_MOVEMENT_LIMITS.settleMax,
						value.trigger - STREAMING_RESPONSE_MOVEMENT_LIMITS.minimumGap,
					)}
					aria-valuetext={t("settings.chat.movement.fromTop", { value: value.settle })}
					min={0}
					max={100}
					step={STREAMING_RESPONSE_MOVEMENT_LIMITS.step}
					value={value.settle}
					onChange={(event) => update("settle", event.currentTarget.value)}
					className={MOVEMENT_THUMB}
				/>
				<input
					type="range"
					data-testid="streaming-movement-trigger"
					aria-label={t("settings.chat.movement.triggerPosition")}
					aria-valuemin={Math.max(
						STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMin,
						value.settle + STREAMING_RESPONSE_MOVEMENT_LIMITS.minimumGap,
					)}
					aria-valuemax={STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMax}
					aria-valuetext={t("settings.chat.movement.fromTop", { value: value.trigger })}
					min={0}
					max={100}
					step={STREAMING_RESPONSE_MOVEMENT_LIMITS.step}
					value={value.trigger}
					onChange={(event) => update("trigger", event.currentTarget.value)}
					className={MOVEMENT_THUMB}
				/>
			</SettingsRangeTrack>
			<div className="flex items-center justify-between gap-8 text-text-muted tr-text-metadata">
				<span>
					<T
						i18nKey="settings.chat.movement.settleValue"
						values={{ value: value.settle }}
						components={[<span key="value" className="text-text-default" />]}
					/>
				</span>
				<span>
					<T
						i18nKey="settings.chat.movement.triggerValue"
						values={{ value: value.trigger }}
						components={[<span key="value" className="text-text-default" />]}
					/>
				</span>
			</div>
		</div>
	);
}

export function ChatSettings() {
	const t = useT();
	const messageOrder = useAppStore((state) => state.chatMessageOrder);
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);
	const streamingResponseMovement = useAppStore((state) => state.streamingResponseMovement);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const subagentsEnabled = useAppStore((state) => state.subagentsEnabled);
	const subagentMaxConcurrent = useAppStore((state) => state.subagentMaxConcurrent);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const setChatMessageOrder = useAppStore((state) => state.setChatMessageOrder);
	const setStreamingResponseMovement = useAppStore((state) => state.setStreamingResponseMovement);

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
				<LineWidthControl kind="chat" />
				<StreamingResponseMovementControl
					value={streamingResponseMovement}
					onChange={setStreamingResponseMovement}
				/>
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
