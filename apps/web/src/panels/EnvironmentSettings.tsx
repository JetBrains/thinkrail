import {
	RiEyeLine as Eye,
	RiEyeOffLine as EyeOff,
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { HostEnvironmentStatus } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { randomId } from "@/lib";
import { getTransport } from "@/transport";
import {
	draftChanged,
	draftFromEnvironment,
	draftIssues,
	type EnvironmentDraft,
	type EnvironmentDraftIssues,
	type EnvironmentIssueCode,
	environmentFromDraft,
	NO_ISSUES,
} from "./environmentDraft";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

const INPUT_CLASS =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-code-text text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active";

const AGENT_DIR_PLACEHOLDER = "~/.pi/agent";
const NAME_PLACEHOLDER = "NAME";
const VALUE_PLACEHOLDER = "value";
const AGENT_DIR_VAR = "PI_CODING_AGENT_DIR";

const ISSUE_TEXT: Record<EnvironmentIssueCode, MessageKey> = {
	notAbsolute: "settings.environment.issue.notAbsolute",
	notFound: "settings.environment.issue.notFound",
	notDirectory: "settings.environment.issue.notDirectory",
	invalidName: "settings.environment.issue.invalidName",
	reserved: "settings.environment.issue.reserved",
	duplicate: "settings.environment.issue.duplicate",
};

export interface EnvironmentFormProps {
	status: HostEnvironmentStatus | "loading" | "failed";
	draft: EnvironmentDraft;
	issues: EnvironmentDraftIssues;
	saving: boolean;
	saveFailed: boolean;
	onChange: (draft: EnvironmentDraft) => void;
	onSave: () => void;
	onDiscard: () => void;
}

export function EnvironmentForm({
	status,
	draft,
	issues,
	saving,
	saveFailed,
	onChange,
	onSave,
	onDiscard,
}: EnvironmentFormProps) {
	const t = useT();
	const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
	if (status === "loading") return null;
	if (status === "failed") {
		return (
			<SettingsNotice variant="error" testId="settings-environment-failed">
				<p>{t("settings.environment.loadFailed")}</p>
			</SettingsNotice>
		);
	}
	const changed = draftChanged(draft, status);
	const overridden = new Set(status.launchOverridden);
	const toggleReveal = (id: string) =>
		setRevealed((current) => {
			const next = new Set(current);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	const updateVar = (id: string, patch: { name?: string; value?: string }) =>
		onChange({
			...draft,
			vars: draft.vars.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
		});

	return (
		<div data-testid="settings-environment" className="flex flex-col gap-16">
			<SettingsGroup
				title={t("settings.environment.title")}
				description={t("settings.environment.description")}
			>
				<fieldset
					disabled={saving}
					data-testid="settings-environment-form"
					className="flex min-w-0 flex-col gap-16 px-12 py-12"
				>
					{status.restartRequired ? (
						<SettingsNotice variant="warning" testId="settings-environment-restart">
							<p>{t("settings.environment.restartRequired")}</p>
						</SettingsNotice>
					) : null}

					<div className="flex flex-col gap-4">
						<label
							htmlFor="settings-environment-agent-dir"
							className="tr-text-ui text-text-default"
						>
							{t("settings.environment.agentDir.label")}
						</label>
						<input
							id="settings-environment-agent-dir"
							data-testid="settings-environment-agent-dir"
							data-settings-draft-input
							aria-invalid={issues.agentDir !== undefined}
							placeholder={AGENT_DIR_PLACEHOLDER}
							value={draft.agentDir}
							onChange={(event) => onChange({ ...draft, agentDir: event.currentTarget.value })}
							className={cn(INPUT_CLASS, issues.agentDir && "border-feedback-error")}
						/>
						{issues.agentDir ? (
							<p
								data-testid="settings-environment-agent-dir-issue"
								className="tr-text-metadata text-feedback-error"
							>
								{t(ISSUE_TEXT[issues.agentDir])}
							</p>
						) : null}
						<p className="tr-text-metadata text-text-muted">
							{t("settings.environment.agentDir.hint")}
						</p>
						{overridden.has(AGENT_DIR_VAR) && status.stored.agentDir !== undefined ? (
							<p
								data-testid="settings-environment-agent-dir-overridden"
								className="tr-text-metadata text-feedback-warning"
							>
								{t("settings.environment.agentDir.launchOverridden")}
							</p>
						) : null}
						<p className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted">
							<span className="shrink-0">{t("settings.environment.agentDir.inUse")}</span>
							<code
								data-testid="settings-environment-agent-dir-effective"
								className="min-w-0 truncate tr-code-text"
							>
								{status.effectiveAgentDir}
							</code>
						</p>
					</div>

					<div className="flex flex-col gap-4">
						<span className="tr-text-ui text-text-default">
							{t("settings.environment.vars.label")}
						</span>
						{draft.vars.map((entry) => {
							const issue = issues.vars[entry.id];
							const shown = revealed.has(entry.id);
							return (
								<div key={entry.id} className="flex flex-col gap-2">
									<div className="flex items-center gap-4" data-testid="settings-environment-var">
										<input
											aria-label={t("settings.environment.vars.name")}
											aria-invalid={issue !== undefined}
											data-testid="settings-environment-var-name"
											data-settings-draft-input
											placeholder={NAME_PLACEHOLDER}
											value={entry.name}
											onChange={(event) => updateVar(entry.id, { name: event.currentTarget.value })}
											className={cn(INPUT_CLASS, "w-[40%]", issue && "border-feedback-error")}
										/>
										<input
											aria-label={t("settings.environment.vars.value")}
											data-testid="settings-environment-var-value"
											data-settings-draft-input
											type={shown ? "text" : "password"}
											autoComplete="off"
											placeholder={VALUE_PLACEHOLDER}
											value={entry.value}
											onChange={(event) =>
												updateVar(entry.id, { value: event.currentTarget.value })
											}
											className={cn(INPUT_CLASS, "flex-1")}
										/>
										{overridden.has(entry.name) ? (
											<span
												data-testid="settings-environment-var-overridden"
												title={t("settings.environment.vars.launchOverriddenHint")}
												className="shrink-0 rounded-sm border border-feedback-warning px-4 tr-text-metadata text-feedback-warning"
											>
												{t("settings.environment.vars.launchOverridden")}
											</span>
										) : null}
										<IconButton
											variant="ghost"
											size="m"
											icon={shown ? EyeOff : Eye}
											label={
												shown
													? t("settings.environment.vars.hide")
													: t("settings.environment.vars.show")
											}
											onClick={() => toggleReveal(entry.id)}
										/>
										<IconButton
											variant="ghost"
											size="m"
											icon={Trash2}
											label={t("common.remove")}
											data-testid="settings-environment-var-remove"
											onClick={() =>
												onChange({
													...draft,
													vars: draft.vars.filter((other) => other.id !== entry.id),
												})
											}
										/>
									</div>
									{issue ? (
										<p
											data-testid="settings-environment-var-issue"
											className="tr-text-metadata text-feedback-error"
										>
											{t(ISSUE_TEXT[issue])}
										</p>
									) : null}
								</div>
							);
						})}
						<Button
							variant="ghost"
							size="m"
							iconLeft={Plus}
							data-testid="settings-environment-add-var"
							className="self-start"
							onClick={() =>
								onChange({
									...draft,
									vars: [...draft.vars, { id: randomId("env"), name: "", value: "" }],
								})
							}
						>
							{t("settings.environment.vars.add")}
						</Button>
					</div>

					{saveFailed ? (
						<SettingsNotice variant="error" testId="settings-environment-save-failed">
							<p>{t("settings.environment.saveFailed")}</p>
						</SettingsNotice>
					) : null}

					<div className="flex justify-end gap-8">
						<Button
							variant="outline"
							data-testid="settings-environment-discard"
							disabled={!changed || saving}
							onClick={onDiscard}
						>
							{t("settings.environment.discard")}
						</Button>
						<Button
							data-testid="settings-environment-save"
							disabled={!changed || saving}
							onClick={onSave}
						>
							{t("common.save")}
						</Button>
					</div>
				</fieldset>
			</SettingsGroup>
		</div>
	);
}

export function EnvironmentSettings() {
	const [status, setStatus] = useState<HostEnvironmentStatus | "loading" | "failed">("loading");
	const [draft, setDraft] = useState<EnvironmentDraft>({ agentDir: "", vars: [] });
	const [issues, setIssues] = useState<EnvironmentDraftIssues>(NO_ISSUES);
	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);

	const adopt = (next: HostEnvironmentStatus) => {
		setStatus(next);
		setDraft(draftFromEnvironment(next.stored));
		setIssues(NO_ISSUES);
	};

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("environment.get", {})
			.then((next) => {
				if (!cancelled) adopt(next);
			})
			.catch(() => !cancelled && setStatus("failed"));
		return () => {
			cancelled = true;
		};
	}, []);

	const save = () => {
		setSaving(true);
		setSaveFailed(false);
		getTransport()
			.request("environment.update", { environment: environmentFromDraft(draft) })
			.then((result) => {
				if (result.ok) adopt(result.status);
				else setIssues(draftIssues(draft, result.issues));
			})
			.catch(() => setSaveFailed(true))
			.finally(() => setSaving(false));
	};

	return (
		<EnvironmentForm
			status={status}
			draft={draft}
			issues={issues}
			saving={saving}
			saveFailed={saveFailed}
			onChange={(next) => {
				setDraft(next);
				setIssues(NO_ISSUES);
			}}
			onSave={save}
			onDiscard={() => {
				if (typeof status === "object") adopt(status);
			}}
		/>
	);
}
