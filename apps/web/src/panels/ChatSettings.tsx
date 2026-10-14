import type { AppConfigUpdate, ComposerGrowthLimit, SubagentOverride } from "@thinkrail/contracts";
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
import { SettingsRow } from "./SettingsRow";
import { SubagentSettings } from "./SubagentSettings";

const MESSAGE_ORDER_OPTIONS: SegmentedControlOption<ChatMessageOrder>[] = [
	{ id: "oldest-first", label: "Oldest first", testId: "chat-order-oldest-first" },
	{ id: "newest-first", label: "Newest first", testId: "chat-order-newest-first" },
];

const GROWTH_OPTIONS: SegmentedControlOption<ComposerGrowthLimit>[] = [
	{ id: "compact", label: "Compact", testId: "composer-growth-compact" },
	{ id: "roomy", label: "Roomy", testId: "composer-growth-roomy" },
	{ id: "half-chat", label: "Half chat", testId: "composer-growth-half-chat" },
];

const MOVEMENT_TRACK_SEGMENTS = Array.from({ length: 20 }, (_, index) => index * 5);

const MOVEMENT_THUMB =
	"pointer-events-none absolute inset-0 h-24 w-full appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-16 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-border-default [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-16 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-border-default [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-primary focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-primary";

function StreamingResponseMovementControl({
	value,
	onChange,
}: {
	value: StreamingResponseMovement;
	onChange: (value: StreamingResponseMovement) => void;
}) {
	const update = (handle: "settle" | "trigger", rawValue: string) => {
		onChange(moveStreamingResponseHandle(value, handle, Number(rawValue)));
	};

	return (
		<div
			data-testid="streaming-response-movement"
			className="flex flex-col gap-8 border-border-muted border-b py-12"
		>
			<div className="flex flex-col gap-2">
				<span className="tr-text-ui text-text-default">Streaming response movement</span>
				<span className="tr-text-metadata text-text-muted">
					When the chat moves while an answer grows, and where its newest edge lands.
				</span>
			</div>
			<div className="flex items-center justify-between text-text-muted tr-text-metadata">
				<span>Top</span>
				<span>Message box</span>
			</div>
			<div className="relative h-24">
				<div className="absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 overflow-hidden rounded-full bg-control-bg">
					{MOVEMENT_TRACK_SEGMENTS.map((start) => (
						<span
							key={start}
							className={cn(
								"h-full flex-1",
								start >= value.settle && start < value.trigger ? "bg-primary" : "bg-control-bg",
							)}
						/>
					))}
				</div>
				<input
					type="range"
					data-testid="streaming-movement-settle"
					aria-label="Settle position"
					aria-valuemin={STREAMING_RESPONSE_MOVEMENT_LIMITS.settleMin}
					aria-valuemax={Math.min(
						STREAMING_RESPONSE_MOVEMENT_LIMITS.settleMax,
						value.trigger - STREAMING_RESPONSE_MOVEMENT_LIMITS.minimumGap,
					)}
					aria-valuetext={`${value.settle}% from the top`}
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
					aria-label="Trigger position"
					aria-valuemin={Math.max(
						STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMin,
						value.settle + STREAMING_RESPONSE_MOVEMENT_LIMITS.minimumGap,
					)}
					aria-valuemax={STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMax}
					aria-valuetext={`${value.trigger}% from the top`}
					min={0}
					max={100}
					step={STREAMING_RESPONSE_MOVEMENT_LIMITS.step}
					value={value.trigger}
					onChange={(event) => update("trigger", event.currentTarget.value)}
					className={MOVEMENT_THUMB}
				/>
			</div>
			<div className="flex items-center justify-between gap-8 text-text-muted tr-text-metadata">
				<span>
					Settle <span className="text-text-default">{value.settle}%</span>
				</span>
				<span>
					Trigger <span className="text-text-default">{value.trigger}%</span>
				</span>
			</div>
		</div>
	);
}

function saveSetting(config: AppConfigUpdate, failure: string): void {
	getTransport()
		.request("settings.update", { config })
		.catch((err: unknown) => toast.error(errorText(err), failure));
}

export function ChatSettings() {
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
		saveSetting({ composerGrowthLimit }, "Couldn't change message box growth");
	};

	const setWorkspaceSubagents = (override: SubagentOverride | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentsOverride", { id: activeWorkspace.id, override })
			.catch((err: unknown) =>
				toast.error(errorText(err), "Couldn't change subagents for this workspace"),
			);
	};

	const setWorkspaceSubagentLimit = (value: number | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentMaxConcurrent", { id: activeWorkspace.id, value })
			.catch((err: unknown) =>
				toast.error(errorText(err), "Couldn't change the subagent limit for this workspace"),
			);
	};

	return (
		<SettingsPageContainer testId="settings-chat">
			<SettingsGroup title="Appearance and behavior">
				<SettingsRow
					label="Message order"
					description="Oldest first shows early messages at top."
					control={
						<SegmentedControl
							name="chat-message-order"
							label="Message order"
							options={MESSAGE_ORDER_OPTIONS}
							value={messageOrder}
							onSelect={selectMessageOrder}
							testId="chat-message-order-control"
						/>
					}
				/>
				<SettingsRow
					label="Composer size"
					description="How tall the message box can grow before scrolling."
					control={
						<SegmentedControl
							name="composer-growth-limit"
							label="Composer size"
							options={GROWTH_OPTIONS}
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
					saveSetting({ subagentsEnabled: enabled }, "Couldn't change the global subagent default")
				}
				onWorkspaceEnabledChange={setWorkspaceSubagents}
				onGlobalLimitChange={(value) =>
					saveSetting({ subagentMaxConcurrent: value }, "Couldn't change the subagent limit")
				}
				onWorkspaceLimitChange={setWorkspaceSubagentLimit}
			/>
		</SettingsPageContainer>
	);
}
