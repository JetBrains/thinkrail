import {
	type AppConfigUpdate,
	AUTO_RESUME_PROTOCOL_VERSION,
	AUTO_RESUME_TIMEOUT_MINUTES,
	type ComposerGrowthLimit,
	isAutoResumeTimeoutMinutes,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import {
	type ChatMessageOrder,
	moveStreamingResponseHandle,
	STREAMING_RESPONSE_MOVEMENT_LIMITS,
	type StreamingResponseMovement,
} from "@/chat/chatPreferences";
import { cn } from "@/lib";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SettingsSwitch } from "./SettingsSwitch";

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
type WorkspaceSubagentChoice = "inherit" | SubagentOverride;

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

function subagentChoices(globalEnabled: boolean): SettingsRadioChoice<WorkspaceSubagentChoice>[] {
	return [
		{
			id: "inherit",
			label: "Use global",
			hint: globalEnabled ? "Currently on" : "Currently off",
			description: "Follows the global default, including later changes.",
			testId: "subagents-workspace-inherit",
		},
		{
			id: "on",
			label: "On",
			hint: "Override",
			description: "Always allow delegation in this workspace.",
			testId: "subagents-workspace-on",
		},
		{
			id: "off",
			label: "Off",
			hint: "Override",
			description: "Prevent new subagents in this workspace.",
			testId: "subagents-workspace-off",
		},
	];
}

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

async function saveSetting(config: AppConfigUpdate, errorMessage: string): Promise<void> {
	try {
		await getTransport().request("settings.update", { config });
	} catch {
		toast.error(errorMessage);
	}
}

export function parseAutoResumeTimeout(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isAutoResumeTimeoutMinutes(value) ? value : null;
}

export function AutoResumeSettings({
	protocolVersion,
	value,
	onChange,
}: {
	protocolVersion: number | null;
	value: number | null;
	onChange: (value: number | null) => Promise<void> | void;
}) {
	const [draft, setDraft] = useState(String(value ?? AUTO_RESUME_TIMEOUT_MINUTES.default));
	const [saving, setSaving] = useState(false);
	useEffect(() => setDraft(String(value ?? AUTO_RESUME_TIMEOUT_MINUTES.default)), [value]);
	if (protocolVersion === null || protocolVersion < AUTO_RESUME_PROTOCOL_VERSION) return null;
	const enabled = value !== null;
	const parsed = parseAutoResumeTimeout(draft);
	const canSave = enabled && parsed !== null && parsed !== value && !saving;
	const errorId = "auto-resume-timeout-error";

	const change = async (next: number | null) => {
		setSaving(true);
		try {
			await onChange(next);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div
			data-testid="settings-auto-resume"
			className="flex flex-col gap-8 border-border-default border-t pt-16"
		>
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Automatic continuation</h3>
				<p className="text-text-muted tr-text-metadata">
					After the timeout, ThinkRail follows marked question recommendations and continues idle
					chats only while their plan has open items. Questions without a recommendation stay
					unanswered. This setting is saved on the host and follows you across devices.
				</p>
			</div>
			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">Continue unfinished chats</span>
					<span className="text-text-muted tr-text-metadata">
						{enabled ? `Wait ${value} minutes before continuing.` : "Off — chats wait for you."}
					</span>
				</div>
				<SettingsSwitch
					checked={enabled}
					disabled={saving}
					label="Automatically continue unfinished chats"
					testId="auto-resume-toggle"
					onChange={(checked) => void change(checked ? AUTO_RESUME_TIMEOUT_MINUTES.default : null)}
				/>
			</div>
			{enabled ? (
				<>
					<div className="flex flex-wrap items-end gap-8">
						<label className="flex flex-col gap-4 text-text-muted tr-text-metadata">
							<span>Wait before continuing</span>
							<span className="flex items-center gap-8">
								<input
									type="number"
									min={AUTO_RESUME_TIMEOUT_MINUTES.min}
									max={AUTO_RESUME_TIMEOUT_MINUTES.max}
									step={1}
									value={draft}
									aria-label="Automatic continuation timeout"
									aria-invalid={parsed === null}
									aria-describedby={parsed === null ? errorId : undefined}
									data-testid="auto-resume-input"
									disabled={saving}
									onChange={(event) => setDraft(event.currentTarget.value)}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											event.preventDefault();
											event.stopPropagation();
											setDraft(String(value));
										} else if (event.key === "Enter" && canSave && parsed !== null) {
											event.preventDefault();
											void change(parsed);
										}
									}}
									className="w-96 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus:border-control-border-active focus:ring-2 focus:ring-primary aria-invalid:border-feedback-error disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text"
								/>
								<span>minutes</span>
							</span>
						</label>
						<button
							type="button"
							disabled={!canSave}
							data-testid="auto-resume-save"
							onClick={() => {
								if (parsed !== null) void change(parsed);
							}}
							className="rounded-[var(--radius-sm)] border border-border-default px-12 py-4 tr-text-ui text-text-default outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text"
						>
							{saving ? "Saving…" : "Save"}
						</button>
					</div>
					{parsed === null ? (
						<p id={errorId} className="text-feedback-error tr-text-metadata">
							Enter a whole number from {AUTO_RESUME_TIMEOUT_MINUTES.min} to{" "}
							{AUTO_RESUME_TIMEOUT_MINUTES.max}.
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}

export function SubagentSettings({
	protocolVersion,
	globalEnabled,
	workspace,
	onGlobalChange,
	onWorkspaceChange,
}: {
	protocolVersion: number | null;
	globalEnabled: boolean;
	workspace: Workspace | null;
	onGlobalChange: (enabled: boolean) => void;
	onWorkspaceChange: (choice: WorkspaceSubagentChoice) => void;
}) {
	if (protocolVersion === null || protocolVersion < SUBAGENT_SETTINGS_PROTOCOL_VERSION) {
		return null;
	}
	return (
		<div
			data-testid="settings-subagents"
			className="flex flex-col gap-8 border-border-default border-t pt-16"
		>
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Subagents</h3>
				<p className="text-text-muted tr-text-metadata">
					Choose whether chats may delegate work to specialized agents. Turning this off prevents
					new subagents; work already running finishes.
				</p>
			</div>
			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">Global default</span>
					<span className="text-text-muted tr-text-metadata">
						{globalEnabled
							? "On — workspaces may delegate unless they override it."
							: "Off — workspaces cannot delegate unless they override it."}
					</span>
				</div>
				<SettingsSwitch
					checked={globalEnabled}
					label="Enable subagents by default"
					testId="subagents-global-toggle"
					onChange={onGlobalChange}
				/>
			</div>

			{workspace ? (
				<div className="flex flex-col gap-8 border-border-default border-t pt-16">
					<div className="flex flex-col gap-4">
						<h4 className="min-w-0 break-words tr-title-compact text-text-default">
							This workspace — {workspace.name}
						</h4>
						<p className="text-text-muted tr-text-metadata">
							Override the global default only for this workspace.
						</p>
					</div>
					<div data-testid="subagents-workspace-options">
						<SettingsRadioCards
							name="workspace-subagents"
							label={`Subagents in ${workspace.name}`}
							choices={subagentChoices(globalEnabled)}
							value={workspace.subagentsOverride ?? "inherit"}
							onSelect={onWorkspaceChange}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

export function ChatSettings() {
	const messageOrder = useAppStore((state) => state.chatMessageOrder);
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);
	const streamingResponseMovement = useAppStore((state) => state.streamingResponseMovement);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const autoResumeTimeoutMinutes = useAppStore((state) => state.autoResumeTimeoutMinutes);
	const subagentsEnabled = useAppStore((state) => state.subagentsEnabled);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const setChatMessageOrder = useAppStore((state) => state.setChatMessageOrder);
	const setStreamingResponseMovement = useAppStore((state) => state.setStreamingResponseMovement);

	const selectMessageOrder = (chatMessageOrder: ChatMessageOrder) => {
		if (chatMessageOrder === messageOrder) return;
		setChatMessageOrder(chatMessageOrder);
	};

	const selectGrowthLimit = (composerGrowthLimit: ComposerGrowthLimit) => {
		if (composerGrowthLimit === growthLimit) return;
		void saveSetting({ composerGrowthLimit }, "Couldn't change message box growth");
	};

	const selectWorkspaceSubagents = (choice: WorkspaceSubagentChoice) => {
		if (!activeWorkspace) return;
		const current = activeWorkspace.subagentsOverride ?? "inherit";
		if (choice === current) return;
		getTransport()
			.request("workspace.setSubagentsOverride", {
				id: activeWorkspace.id,
				override: choice === "inherit" ? null : choice,
			})
			.catch(() => toast.error("Couldn't change subagents for this workspace"));
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

			<AutoResumeSettings
				protocolVersion={protocolVersion}
				value={autoResumeTimeoutMinutes}
				onChange={(autoResumeTimeoutMinutes) =>
					saveSetting({ autoResumeTimeoutMinutes }, "Couldn't change automatic continuation")
				}
			/>

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
				workspace={activeWorkspace}
				onGlobalChange={(enabled) =>
					saveSetting({ subagentsEnabled: enabled }, "Couldn't change the global subagent default")
				}
				onWorkspaceChange={selectWorkspaceSubagents}
			/>
		</section>
	);
}
