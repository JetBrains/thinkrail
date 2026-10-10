import type { AppConfigUpdate, ComposerGrowthLimit, SubagentOverride } from "@thinkrail/contracts";
import { cn } from "@thinkrail/ui/utils";
import {
	type ChatMessageOrder,
	moveStreamingResponseHandle,
	STREAMING_RESPONSE_MOVEMENT_LIMITS,
	type StreamingResponseMovement,
} from "@/chat/chatPreferences";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SubagentSettings } from "./SubagentSettings";

const MESSAGE_ORDER_CHOICES: SettingsRadioChoice<ChatMessageOrder>[] = [
	{
		id: "oldest-first",
		label: "Oldest first",
		hint: "Default",
		description: "Shows the earliest request at the top and the latest work at the bottom.",
		testId: "chat-order-oldest-first",
	},
	{
		id: "newest-first",
		label: "Newest first",
		hint: "Latest at top",
		description:
			"Shows the newest item first inside the latest request-and-answer group, followed by older groups.",
		testId: "chat-order-newest-first",
	},
];

const MOVEMENT_TRACK_SEGMENTS = Array.from({ length: 20 }, (_, index) => index * 5);

const GROWTH_CHOICES: SettingsRadioChoice<ComposerGrowthLimit>[] = [
	{
		id: "compact",
		label: "Compact",
		hint: "6 lines",
		description: "Keeps long drafts to six visual lines before scrolling.",
		testId: "composer-growth-compact",
	},
	{
		id: "roomy",
		label: "Roomy",
		hint: "10 lines",
		description: "Keeps long drafts to ten visual lines before scrolling.",
		testId: "composer-growth-roomy",
	},
	{
		id: "half-chat",
		label: "Half chat",
		hint: "Default",
		description: "Uses up to half of the mounted chat panel before scrolling.",
		testId: "composer-growth-half-chat",
	},
];

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
	const thumbClasses =
		"pointer-events-none absolute inset-0 h-24 w-full appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-16 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-border-default [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-16 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-border-default [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-primary focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-primary";

	return (
		<div
			data-testid="streaming-response-movement"
			className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-12"
		>
			<div className="flex items-center justify-between text-text-muted tr-text-metadata">
				<span>Top</span>
				<span>Message box</span>
			</div>
			<div className="relative mt-8 h-24">
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
					className={thumbClasses}
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
					className={thumbClasses}
				/>
			</div>
			<div className="mt-8 flex items-center justify-between gap-8 text-text-muted tr-text-metadata">
				<span>
					Settle <strong className="text-text-default">{value.settle}%</strong>
				</span>
				<span>
					Trigger <strong className="text-text-default">{value.trigger}%</strong>
				</span>
			</div>
		</div>
	);
}

function saveSetting(config: AppConfigUpdate, errorMessage: string): void {
	getTransport()
		.request("settings.update", { config })
		.catch(() => toast.error(errorMessage));
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
			.catch(() => toast.error("Couldn't change subagents for this workspace"));
	};

	const setWorkspaceSubagentLimit = (value: number | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentMaxConcurrent", { id: activeWorkspace.id, value })
			.catch(() => toast.error("Couldn't change the subagent limit for this workspace"));
	};

	return (
		<section data-testid="settings-chat" className="flex flex-col gap-16">
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Message order</h3>
					<p className="text-text-muted tr-text-metadata">
						Choose whether the oldest or newest work appears first. The message box stays at the
						bottom. Your choice is saved in this client for this host only.
					</p>
				</div>
				<SettingsRadioCards
					name="chat-message-order"
					label="Chat message order"
					choices={MESSAGE_ORDER_CHOICES}
					value={messageOrder}
					onSelect={selectMessageOrder}
				/>
			</div>

			<div className="flex flex-col gap-8 border-border-default border-t pt-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Streaming response movement</h3>
					<p className="text-text-muted tr-text-metadata">
						Choose when the chat moves while an answer grows and where its newest edge lands. Your
						choice is saved in this client for this host only.
					</p>
				</div>
				<StreamingResponseMovementControl
					value={streamingResponseMovement}
					onChange={setStreamingResponseMovement}
				/>
			</div>

			<div className="flex flex-col gap-8 border-border-default border-t pt-16">
				<div className="flex flex-col gap-4">
					<h3 className="tr-title-section text-text-default">Message box growth</h3>
					<p className="text-text-muted tr-text-metadata">
						Choose how tall long drafts may grow before the message box scrolls. Your choice is
						saved on the host and follows you across devices.
					</p>
				</div>
				<SettingsRadioCards
					name="composer-growth-limit"
					label="Message box growth limit"
					choices={GROWTH_CHOICES}
					value={growthLimit}
					onSelect={selectGrowthLimit}
				/>
			</div>

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
		</section>
	);
}
