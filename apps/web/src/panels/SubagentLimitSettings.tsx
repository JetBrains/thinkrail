import {
	isSubagentMaxConcurrent,
	SUBAGENT_MAX_CONCURRENT,
	type Workspace,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";

type WorkspaceLimitChoice = "inherit" | "custom";

function parseLimit(draft: string): number | null {
	if (!/^\d+$/.test(draft)) return null;
	const value = Number(draft);
	return isSubagentMaxConcurrent(value) ? value : null;
}

function SubagentLimitInput({
	initial,
	saved,
	label,
	testId,
	onSave,
}: {
	initial: number;
	saved: number | undefined;
	label: string;
	testId: string;
	onSave: (value: number) => void;
}) {
	const [draft, setDraft] = useState(String(initial));
	useEffect(() => setDraft(String(initial)), [initial]);
	const parsed = parseLimit(draft);
	const errorId = `${testId}-error`;

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (parsed !== null && parsed !== saved) onSave(parsed);
			}}
		>
			<div className="flex flex-wrap items-center gap-8">
				<input
					type="number"
					min={SUBAGENT_MAX_CONCURRENT.min}
					max={SUBAGENT_MAX_CONCURRENT.max}
					step={1}
					inputMode="numeric"
					value={draft}
					aria-label={label}
					aria-invalid={parsed === null}
					aria-describedby={parsed === null ? errorId : undefined}
					data-testid={`${testId}-input`}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						setDraft(String(initial));
					}}
					className="w-64 rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default outline-none focus:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary aria-invalid:border-feedback-error"
				/>
				<span className="text-text-muted tr-text-metadata">at once</span>
				<Button
					type="submit"
					variant="outline"
					size="sm"
					disabled={parsed === null || parsed === saved}
					data-testid={`${testId}-apply`}
				>
					Apply
				</Button>
			</div>
			{parsed === null ? (
				<p id={errorId} className="text-feedback-error tr-text-metadata">
					Enter a whole number from {SUBAGENT_MAX_CONCURRENT.min} to {SUBAGENT_MAX_CONCURRENT.max}.
				</p>
			) : null}
		</form>
	);
}

export function GlobalSubagentLimit({
	value,
	onChange,
}: {
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<div
			data-testid="subagent-limit-global"
			className="flex flex-wrap items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8"
		>
			<div className="flex flex-col gap-2">
				<span className="tr-title-compact text-text-default">Subagents per chat</span>
				<span className="text-text-muted tr-text-metadata">
					How many one chat may run at once; more wait in line. Changes apply to running chats.
				</span>
			</div>
			<SubagentLimitInput
				initial={value}
				saved={value}
				label="Global subagents per chat"
				testId="subagent-limit-global"
				onSave={onChange}
			/>
		</div>
	);
}

export function WorkspaceSubagentLimit({
	workspace,
	globalLimit,
	onChange,
}: {
	workspace: Workspace;
	globalLimit: number;
	onChange: (value: number | null) => void;
}) {
	const override = isSubagentMaxConcurrent(workspace.subagentMaxConcurrentOverride)
		? workspace.subagentMaxConcurrentOverride
		: undefined;
	const [customDraft, setCustomDraft] = useState(false);
	useEffect(() => {
		if (override !== undefined) setCustomDraft(false);
	}, [override]);
	const choice: WorkspaceLimitChoice = override !== undefined || customDraft ? "custom" : "inherit";
	const choices: SettingsRadioChoice<WorkspaceLimitChoice>[] = [
		{
			id: "inherit",
			label: "Use global",
			hint: `Currently ${globalLimit}`,
			description: "Follows the global limit, including later changes.",
			testId: "subagent-limit-workspace-inherit",
		},
		{
			id: "custom",
			label: "Custom",
			hint: override === undefined ? "Override" : `${override} at once`,
			description: "Sets a different limit only for this workspace.",
			testId: "subagent-limit-workspace-custom",
		},
	];

	const select = (next: WorkspaceLimitChoice) => {
		if (next === choice) return;
		setCustomDraft(next === "custom");
		if (next === "inherit" && override !== undefined) onChange(null);
	};

	return (
		<div data-testid="subagent-limit-workspace" className="flex flex-col gap-8">
			<span className="tr-title-compact text-text-default">Subagents per chat</span>
			<SettingsRadioCards
				name="workspace-subagent-limit"
				label={`Subagents per chat in ${workspace.name}`}
				choices={choices}
				value={choice}
				onSelect={select}
			/>
			{choice === "custom" ? (
				<SubagentLimitInput
					initial={override ?? globalLimit}
					saved={override}
					label={`Subagents per chat in ${workspace.name}`}
					testId="subagent-limit-workspace"
					onSave={onChange}
				/>
			) : null}
		</div>
	);
}
