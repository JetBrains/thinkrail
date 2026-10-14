import {
	type AppConfigUpdate,
	type ComposerGrowthLimit,
	isLineWidth,
	LINE_WIDTH_COLUMNS,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import type { ChatMessageOrder, StreamingResponseMovement } from "@/chat/chatPreferences";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SegmentedControl, type SegmentedControlOption } from "./SegmentedControl";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRadioGroup, type SettingsRadioOption } from "./SettingsRadioGroup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";

const MESSAGE_ORDER_OPTIONS: SegmentedControlOption<ChatMessageOrder>[] = [
	{ id: "oldest-first", label: "Oldest first", testId: "chat-order-oldest-first" },
	{ id: "newest-first", label: "Newest first", testId: "chat-order-newest-first" },
];

const GROWTH_OPTIONS: SegmentedControlOption<ComposerGrowthLimit>[] = [
	{ id: "compact", label: "Compact", testId: "composer-growth-compact" },
	{ id: "roomy", label: "Roomy", testId: "composer-growth-roomy" },
	{ id: "half-chat", label: "Half chat", testId: "composer-growth-half-chat" },
];

type WorkspaceSubagentChoice = "inherit" | SubagentOverride;

/** Map streaming behavior to a simplified three-mode model */
type ScrollingMode = "follow" | "keep-position" | "stay-at-bottom";

const SCROLLING_OPTIONS: SettingsRadioOption<ScrollingMode>[] = [
	{
		id: "follow",
		label: "Follow response",
		description: "Automatically scroll to keep the latest generated text visible.",
		testId: "scrolling-follow",
	},
	{
		id: "keep-position",
		label: "Keep position",
		description: "Keep your current scroll position while the agent responds.",
		testId: "scrolling-keep-position",
	},
	{
		id: "stay-at-bottom",
		label: "Stay at bottom",
		description: "Keep the chat at the bottom as new content appears.",
		testId: "scrolling-stay-at-bottom",
	},
];

/** Convert internal settle/trigger values to user-facing mode */
function toScrollingMode(value: StreamingResponseMovement): ScrollingMode {
	// "follow" = default behavior with settle ~50%, trigger ~70%
	// "keep-position" = settle and trigger both at 100% (never auto-scroll)
	// "stay-at-bottom" = settle at minimum, trigger near bottom (always scroll)
	if (value.settle >= 90 && value.trigger >= 95) return "keep-position";
	if (value.settle <= 30 && value.trigger >= 95) return "stay-at-bottom";
	return "follow";
}

/** Convert user-facing mode to internal values */
function fromScrollingMode(mode: ScrollingMode): StreamingResponseMovement {
	switch (mode) {
		case "follow":
			return { settle: 50, trigger: 70 };
		case "keep-position":
			return { settle: 100, trigger: 100 };
		case "stay-at-bottom":
			return { settle: 25, trigger: 95 };
	}
}

function saveSetting(config: AppConfigUpdate, errorMessage: string): void {
	getTransport()
		.request("settings.update", { config })
		.catch(() => toast.error(errorMessage));
}

function LineWidthInput({
	value,
	onSave,
}: {
	value: number;
	onSave: (value: number) => Promise<void>;
}) {
	const [draft, setDraft] = useState(String(value));
	const [saving, setSaving] = useState(false);
	useEffect(() => setDraft(String(value)), [value]);

	const parsed = /^\d+$/.test(draft) ? Number(draft) : null;
	const valid = parsed !== null && isLineWidth(parsed);
	const canSave = valid && parsed !== value && !saving;

	const save = async () => {
		if (!canSave || parsed === null) return;
		setSaving(true);
		try {
			await onSave(parsed);
		} finally {
			setSaving(false);
		}
	};

	return (
		<input
			type="number"
			min={LINE_WIDTH_COLUMNS.min}
			max={LINE_WIDTH_COLUMNS.max}
			step={1}
			value={draft}
			aria-label="Line width"
			aria-invalid={!valid}
			data-testid="chat-line-width-input"
			data-line-width-input
			onChange={(event) => setDraft(event.currentTarget.value)}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					setDraft(String(value));
				} else if (event.key === "Enter" && canSave) {
					event.preventDefault();
					void save();
				}
			}}
			onBlur={() => {
				if (canSave) void save();
			}}
			className="h-32 w-80 rounded-sm border border-control-border-default bg-control-bg px-8 tr-text-ui text-text-default outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-control-border-active aria-invalid:border-feedback-error"
		/>
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

	const workspaceOptions: SettingsRadioOption<WorkspaceSubagentChoice>[] = [
		{
			id: "inherit",
			label: "Use global setting",
			description: "Follow the global subagent setting for this workspace.",
			hint: globalEnabled ? "Currently On" : "Currently Off",
			testId: "subagents-workspace-inherit",
		},
		{
			id: "on",
			label: "On",
			description: "Always allow delegation in this workspace.",
			testId: "subagents-workspace-on",
		},
		{
			id: "off",
			label: "Off",
			description: "Prevent new subagents in this workspace.",
			testId: "subagents-workspace-off",
		},
	];

	return (
		<SettingsGroup
			testId="settings-subagents"
			title="Subagents"
			description="Allow chats to delegate work to specialized agents."
		>
			<SettingsRow
				label="Enable subagents"
				description={
					globalEnabled ? "Workspaces may delegate by default." : "Delegation is off by default."
				}
				control={
					<SettingsSwitch
						checked={globalEnabled}
						label="Enable subagents by default"
						testId="subagents-global-toggle"
						onChange={onGlobalChange}
					/>
				}
			/>

			{/* Workspace-specific override - vertical layout with radio group below */}
			{workspace && (
				<div data-testid="subagents-workspace-row" className="flex flex-col gap-8 py-12">
					<div className="flex flex-col gap-2">
						<span className="tr-text-ui text-text-default">This workspace</span>
						<span className="tr-text-metadata text-text-muted">
							Override the global subagent setting for this workspace.
						</span>
					</div>
					<SettingsRadioGroup
						name="workspace-subagents"
						label={`Subagents in ${workspace.name}`}
						options={workspaceOptions}
						value={workspace.subagentsOverride ?? "inherit"}
						onSelect={onWorkspaceChange}
						testId="subagents-workspace-options"
					/>
				</div>
			)}
		</SettingsGroup>
	);
}

export function ChatSettings() {
	const messageOrder = useAppStore((state) => state.chatMessageOrder);
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);
	const streamingResponseMovement = useAppStore((state) => state.streamingResponseMovement);
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const subagentsEnabled = useAppStore((state) => state.subagentsEnabled);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const chatLineWidth = useAppStore((state) => state.chatLineWidth);
	const chatLineWidthBounded = useAppStore((state) => state.chatLineWidthBounded);
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

	const scrollingMode = toScrollingMode(streamingResponseMovement);
	const selectScrollingMode = (mode: ScrollingMode) => {
		if (mode === scrollingMode) return;
		setStreamingResponseMovement(fromScrollingMode(mode));
	};

	return (
		<SettingsPageContainer testId="settings-chat">
			{/* GROUP 1: Appearance and behavior */}
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
				<SettingsRow
					label="Line width"
					description="Maximum characters per line in chat."
					control={
						<LineWidthInput
							value={chatLineWidth}
							onSave={async (chatLineWidth) => {
								await getTransport().request("settings.update", { config: { chatLineWidth } });
							}}
						/>
					}
				/>
				<SettingsRow
					label="Fit to pane"
					description="Wrap lines shorter when the pane is narrow."
					testId="chat-line-width-bounded"
					control={
						<SettingsSwitch
							checked={chatLineWidthBounded}
							label="Fit line width to pane"
							testId="chat-line-width-bounded-toggle"
							onChange={(chatLineWidthBounded) => {
								saveSetting({ chatLineWidthBounded }, "Couldn't change line width setting");
							}}
						/>
					}
				/>
				{/* Scrolling during responses - vertical layout within Appearance and behavior */}
				<div data-testid="scrolling-during-responses" className="flex flex-col gap-8 py-12">
					<div className="flex flex-col gap-2">
						<span className="tr-text-ui text-text-default">Scrolling during responses</span>
						<span className="tr-text-metadata text-text-muted">
							How the chat scrolls while the agent is generating.
						</span>
					</div>
					<SettingsRadioGroup
						name="scrolling-mode"
						label="Scrolling during responses"
						options={SCROLLING_OPTIONS}
						value={scrollingMode}
						onSelect={selectScrollingMode}
						testId="scrolling-mode-control"
					/>
				</div>
			</SettingsGroup>

			{/* GROUP 2: Subagents */}
			<SubagentSettings
				protocolVersion={protocolVersion}
				globalEnabled={subagentsEnabled}
				workspace={activeWorkspace}
				onGlobalChange={(enabled) =>
					saveSetting({ subagentsEnabled: enabled }, "Couldn't change the global subagent default")
				}
				onWorkspaceChange={selectWorkspaceSubagents}
			/>
		</SettingsPageContainer>
	);
}
