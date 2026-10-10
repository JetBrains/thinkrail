import { RiArrowGoBackLine } from "@remixicon/react";
import {
	isSubagentMaxConcurrent,
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	SUBAGENT_MAX_CONCURRENT,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	type SubagentOverride,
	type Workspace,
} from "@thinkrail/contracts";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { SettingsSwitch } from "./SettingsSwitch";

function parseLimit(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isSubagentMaxConcurrent(value) ? value : null;
}

function SourceTag({
	custom,
	resetLabel,
	testId,
	onReset,
}: {
	custom: boolean;
	resetLabel: string;
	testId: string;
	onReset: () => void;
}) {
	if (!custom) {
		return (
			<span
				data-testid={testId}
				data-source="global"
				className="rounded-[var(--radius-sm)] border border-border-default px-4 text-text-subtle tr-text-metadata"
			>
				Global
			</span>
		);
	}
	return (
		<button
			type="button"
			data-testid={testId}
			data-source="custom"
			aria-label={resetLabel}
			title="Use global"
			onClick={onReset}
			className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-primary-muted px-4 text-primary tr-text-metadata outline-none hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-primary"
		>
			Custom
			<RiArrowGoBackLine aria-hidden className="size-12" />
		</button>
	);
}

function LimitField({
	saved,
	placeholder,
	allowEmpty,
	disabled = false,
	label,
	testId,
	onCommit,
}: {
	saved: number | undefined;
	placeholder?: number;
	allowEmpty: boolean;
	disabled?: boolean;
	label: string;
	testId: string;
	onCommit: (value: number | null) => void;
}) {
	const savedText = saved === undefined ? "" : String(saved);
	const [draft, setDraft] = useState(savedText);
	useEffect(() => setDraft(savedText), [savedText]);
	const parsed = parseLimit(draft);
	const empty = draft === "";
	const invalid = parsed === null && !(allowEmpty && empty);
	const errorId = `${testId}-error`;

	const commit = () => {
		if (invalid) {
			setDraft(savedText);
			return;
		}
		if (draft !== savedText) onCommit(parsed);
	};

	return (
		<span className="flex flex-col gap-2">
			<input
				type="number"
				min={SUBAGENT_MAX_CONCURRENT.min}
				max={SUBAGENT_MAX_CONCURRENT.max}
				step={1}
				inputMode="numeric"
				value={draft}
				placeholder={placeholder === undefined ? undefined : String(placeholder)}
				disabled={disabled}
				aria-label={label}
				aria-invalid={invalid}
				aria-describedby={invalid ? errorId : undefined}
				data-testid={testId}
				data-settings-draft-input
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						setDraft(savedText);
					}
				}}
				className="w-56 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 text-right tr-text-ui text-text-default outline-none placeholder:text-text-subtle focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary disabled:border-control-disabled-border disabled:bg-control-disabled-bg disabled:text-control-disabled-text aria-invalid:border-feedback-error"
			/>
			{invalid ? (
				<span id={errorId} className="text-feedback-error tr-text-metadata">
					Use {SUBAGENT_MAX_CONCURRENT.min}–{SUBAGENT_MAX_CONCURRENT.max}
				</span>
			) : null}
		</span>
	);
}

const ROW_HEADER = "px-12 py-8 text-left align-middle font-normal";
const CELL = "px-8 py-8 align-middle";

export function SubagentSettings({
	protocolVersion,
	globalEnabled,
	globalLimit,
	workspace,
	onGlobalEnabledChange,
	onWorkspaceEnabledChange,
	onGlobalLimitChange,
	onWorkspaceLimitChange,
}: {
	protocolVersion: number | null;
	globalEnabled: boolean;
	globalLimit: number;
	workspace: Workspace | null;
	onGlobalEnabledChange: (enabled: boolean) => void;
	onWorkspaceEnabledChange: (override: SubagentOverride | null) => void;
	onGlobalLimitChange: (value: number) => void;
	onWorkspaceLimitChange: (value: number | null) => void;
}) {
	if (protocolVersion === null || protocolVersion < SUBAGENT_SETTINGS_PROTOCOL_VERSION) {
		return null;
	}
	const limitSupported = protocolVersion >= SUBAGENT_CONCURRENCY_PROTOCOL_VERSION;
	const enabledOverride = workspace?.subagentsOverride;
	const workspaceEnabled = enabledOverride === undefined ? globalEnabled : enabledOverride === "on";
	const rawLimitOverride = workspace?.subagentMaxConcurrentOverride;
	const limitOverride = isSubagentMaxConcurrent(rawLimitOverride) ? rawLimitOverride : undefined;

	return (
		<div
			data-testid="settings-subagents"
			className="flex flex-col gap-8 border-border-default border-t pt-16"
		>
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Subagents</h3>
				<p className="text-text-muted tr-text-metadata">
					Let chats delegate work to specialized agents.
					{workspace
						? " A workspace follows the global column until you change one of its values."
						: ""}{" "}
					Work already running always finishes.
				</p>
			</div>
			<div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-control-bg">
				<table data-testid="subagents-table" className="w-full table-fixed border-collapse">
					<colgroup>
						<col />
						<col className="w-128" />
						{workspace ? <col className="w-144" /> : null}
					</colgroup>
					<thead>
						<tr className="text-text-muted tr-text-metadata">
							<td className={ROW_HEADER} />
							<th scope="col" className={cn(CELL, "text-left font-normal")}>
								Global
							</th>
							{workspace ? (
								<th
									scope="col"
									data-testid="subagents-workspace-heading"
									title={workspace.name}
									className={cn(CELL, "text-left font-normal")}
								>
									<span className="block">This workspace</span>
									<span className="block break-words text-text-subtle">{workspace.name}</span>
								</th>
							) : null}
						</tr>
					</thead>
					<tbody>
						<tr className="border-border-default border-t">
							<th scope="row" className={ROW_HEADER}>
								<span className="block tr-title-compact text-text-default">Allow subagents</span>
							</th>
							<td className={CELL}>
								<SettingsSwitch
									checked={globalEnabled}
									label="Allow subagents globally"
									testId="subagents-global-toggle"
									onChange={onGlobalEnabledChange}
								/>
							</td>
							{workspace ? (
								<td className={CELL}>
									<span className="flex flex-wrap items-center gap-4">
										<SettingsSwitch
											checked={workspaceEnabled}
											label={`Allow subagents in ${workspace.name}`}
											testId="subagents-workspace-toggle"
											onChange={(enabled) => onWorkspaceEnabledChange(enabled ? "on" : "off")}
										/>
										<SourceTag
											custom={enabledOverride !== undefined}
											resetLabel={`Custom — use the global subagent setting in ${workspace.name}`}
											testId="subagents-workspace-source"
											onReset={() => onWorkspaceEnabledChange(null)}
										/>
									</span>
								</td>
							) : null}
						</tr>
						{limitSupported ? (
							<tr className="border-border-default border-t">
								<th scope="row" className={ROW_HEADER}>
									<span className="block tr-title-compact text-text-default">Per chat at once</span>
									<span className="block text-text-muted tr-text-metadata">More wait in line.</span>
								</th>
								<td className={CELL}>
									<LimitField
										saved={globalLimit}
										allowEmpty={false}
										label="Global subagents per chat"
										testId="subagent-limit-global-input"
										onCommit={(value) => {
											if (value !== null) onGlobalLimitChange(value);
										}}
									/>
								</td>
								{workspace ? (
									<td className={CELL}>
										<span className="flex flex-wrap items-center gap-4">
											<LimitField
												saved={limitOverride}
												placeholder={globalLimit}
												allowEmpty
												disabled={!workspaceEnabled}
												label={`Subagents per chat in ${workspace.name}`}
												testId="subagent-limit-workspace-input"
												onCommit={onWorkspaceLimitChange}
											/>
											<SourceTag
												custom={limitOverride !== undefined}
												resetLabel={`Custom — use the global subagent limit in ${workspace.name}`}
												testId="subagent-limit-workspace-source"
												onReset={() => onWorkspaceLimitChange(null)}
											/>
										</span>
									</td>
								) : null}
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}
