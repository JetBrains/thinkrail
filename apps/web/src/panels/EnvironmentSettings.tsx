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
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, useEffect, useState } from "react";
import { randomId } from "@/lib";
import {
	SETTINGS_INPUT,
	SettingsGroup,
	SettingsLine,
	SettingsNotice,
	SettingsPage,
	SettingsRow,
} from "@/settingsKit";
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
	revertDraftField,
} from "./environmentDraft";
import { SETTING, settingProps } from "./settingsCatalog";

const INPUT_CLASS = cn(SETTINGS_INPUT, "min-w-0 tr-code-text");

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
	baseline?: EnvironmentDraft;
	issues: EnvironmentDraftIssues;
	saving: boolean;
	saveFailed: boolean;
	onChange: (draft: EnvironmentDraft) => void;
	onSave: () => void;
	onDiscard: () => void;
	onRetry?: () => void;
}

export function EnvironmentForm({
	status,
	draft,
	baseline = draft,
	issues,
	saving,
	saveFailed,
	onChange,
	onSave,
	onDiscard,
	onRetry,
}: EnvironmentFormProps) {
	const t = useT();
	const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
	const title = t("settings.nav.environment");
	const description = t("settings.environment.description");
	if (status === "loading") return null;
	if (status === "failed") {
		return (
			<SettingsPage testId="settings-environment" title={title} description={description}>
				<SettingsNotice
					variant="error"
					rowId="environment-failed"
					testId="settings-environment-failed"
					action={
						onRetry ? (
							<Button
								variant="outline"
								size="s"
								tabIndex={0}
								data-testid="settings-environment-retry"
								onClick={onRetry}
							>
								{t("common.retry")}
							</Button>
						) : undefined
					}
				>
					<p>{t("settings.environment.loadFailed")}</p>
				</SettingsNotice>
			</SettingsPage>
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
	const revertOnEscape =
		(field: Parameters<typeof revertDraftField>[2]) => (event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key !== "Escape" || isImeComposing(event.nativeEvent)) return;
			const next = revertDraftField(draft, baseline, field);
			if (!next) return;
			event.preventDefault();
			onChange(next);
		};

	return (
		<SettingsPage testId="settings-environment" title={title} description={description}>
			<fieldset
				disabled={saving}
				data-testid="settings-environment-form"
				className="flex min-w-0 flex-col gap-24"
			>
				{status.restartRequired ? (
					<SettingsNotice variant="warning" testId="settings-environment-restart">
						<p>{t("settings.environment.restartRequired")}</p>
					</SettingsNotice>
				) : null}

				<SettingsGroup title={t("settings.environment.agentDir.group")} scope="device">
					<SettingsRow
						{...settingProps(t, SETTING.piConfigFolder)}
						description={
							<span className="flex flex-col gap-2">
								<span>{t("settings.environment.agentDir.hint")}</span>
								<span className="flex min-w-0 flex-wrap items-baseline gap-x-8">
									<span>{t("settings.environment.agentDir.inUse")}</span>
									<code
										data-testid="settings-environment-agent-dir-effective"
										className="wrap-anywhere min-w-0 tr-code-text-small"
									>
										{status.effectiveAgentDir}
									</code>
								</span>
								{overridden.has(AGENT_DIR_VAR) && status.stored.agentDir !== undefined ? (
									<span
										data-testid="settings-environment-agent-dir-overridden"
										className="text-feedback-warning"
									>
										{t("settings.environment.agentDir.launchOverridden")}
									</span>
								) : null}
							</span>
						}
						control={
							<span className="flex flex-col items-end gap-2">
								<input
									id="settings-environment-agent-dir"
									tabIndex={0}
									data-testid="settings-environment-agent-dir"
									aria-label={t("settings.environment.agentDir.label")}
									aria-invalid={issues.agentDir !== undefined}
									placeholder={AGENT_DIR_PLACEHOLDER}
									value={draft.agentDir}
									onChange={(event) => onChange({ ...draft, agentDir: event.currentTarget.value })}
									onKeyDown={revertOnEscape({ kind: "agentDir" })}
									className={cn(INPUT_CLASS, "w-[20rem] max-w-full")}
								/>
								{issues.agentDir ? (
									<span
										data-testid="settings-environment-agent-dir-issue"
										className="tr-text-metadata text-feedback-error"
									>
										{t(ISSUE_TEXT[issues.agentDir])}
									</span>
								) : null}
							</span>
						}
					/>
				</SettingsGroup>

				<SettingsGroup
					title={t("settings.environment.vars.label")}
					scope="device"
					description={t("settings.environment.vars.description")}
				>
					<div data-setting-id={SETTING.environmentVariables.id} className="flex flex-col">
						{draft.vars.map((entry) => {
							const issue = issues.vars[entry.id];
							const shown = revealed.has(entry.id);
							const launchSet = overridden.has(entry.name);
							return (
								<SettingsLine
									key={entry.id}
									rowId={`environment-var/${entry.id}`}
									className="flex flex-col gap-2 border-border-muted border-b py-8"
								>
									<div className="flex items-center gap-4" data-testid="settings-environment-var">
										<input
											tabIndex={0}
											aria-label={t("settings.environment.vars.name")}
											aria-invalid={issue !== undefined}
											data-testid="settings-environment-var-name"
											placeholder={NAME_PLACEHOLDER}
											value={entry.name}
											onChange={(event) => updateVar(entry.id, { name: event.currentTarget.value })}
											onKeyDown={revertOnEscape({ kind: "name", id: entry.id })}
											className={cn(INPUT_CLASS, "w-[40%]")}
										/>
										<input
											tabIndex={0}
											aria-label={t("settings.environment.vars.value")}
											data-testid="settings-environment-var-value"
											type={shown ? "text" : "password"}
											autoComplete="off"
											placeholder={VALUE_PLACEHOLDER}
											value={entry.value}
											onChange={(event) =>
												updateVar(entry.id, { value: event.currentTarget.value })
											}
											onKeyDown={revertOnEscape({ kind: "value", id: entry.id })}
											className={cn(INPUT_CLASS, "flex-1")}
										/>
										{launchSet ? (
											<span
												data-testid="settings-environment-var-overridden"
												className="shrink-0 rounded-sm border border-feedback-warning px-4 tr-text-metadata text-feedback-warning"
											>
												{t("settings.environment.vars.launchOverridden")}
											</span>
										) : null}
										<IconButton
											variant="ghost"
											size="m"
											tabIndex={0}
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
											tabIndex={0}
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
									{launchSet ? (
										<p
											data-testid="settings-environment-var-overridden-hint"
											className="tr-text-metadata text-text-muted"
										>
											{t("settings.environment.vars.launchOverriddenHint")}
										</p>
									) : null}
									{issue ? (
										<p
											data-testid="settings-environment-var-issue"
											className="tr-text-metadata text-feedback-error"
										>
											{t(ISSUE_TEXT[issue])}
										</p>
									) : null}
								</SettingsLine>
							);
						})}
						<SettingsLine rowId="environment-add-var" className="py-8">
							<Button
								variant="ghost"
								size="m"
								iconLeft={Plus}
								tabIndex={0}
								data-testid="settings-environment-add-var"
								onClick={() =>
									onChange({
										...draft,
										vars: [...draft.vars, { id: randomId("env"), name: "", value: "" }],
									})
								}
							>
								{t("settings.environment.vars.add")}
							</Button>
						</SettingsLine>
					</div>
				</SettingsGroup>

				{saveFailed ? (
					<SettingsNotice variant="error" testId="settings-environment-save-failed">
						<p>{t("settings.environment.saveFailed")}</p>
					</SettingsNotice>
				) : null}

				<SettingsLine
					rowId="environment-save"
					className="flex flex-wrap items-center justify-end gap-8 py-8"
				>
					<Button
						variant="outline"
						tabIndex={0}
						data-testid="settings-environment-discard"
						disabled={!changed || saving}
						onClick={onDiscard}
					>
						{t("settings.environment.discard")}
					</Button>
					<Button
						tabIndex={0}
						data-testid="settings-environment-save"
						disabled={!changed || saving}
						onClick={onSave}
					>
						{t("common.save")}
					</Button>
				</SettingsLine>
			</fieldset>
		</SettingsPage>
	);
}

export function EnvironmentSettings() {
	const [status, setStatus] = useState<HostEnvironmentStatus | "loading" | "failed">("loading");
	const [draft, setDraft] = useState<EnvironmentDraft>({ agentDir: "", vars: [] });
	const [baseline, setBaseline] = useState<EnvironmentDraft>({ agentDir: "", vars: [] });
	const [issues, setIssues] = useState<EnvironmentDraftIssues>(NO_ISSUES);
	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);

	const adopt = (next: HostEnvironmentStatus) => {
		const fresh = draftFromEnvironment(next.stored);
		setStatus(next);
		setDraft(fresh);
		setBaseline(fresh);
		setIssues(NO_ISSUES);
	};

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("environment.get", {})
			.then((next) => {
				if (cancelled) return;
				const fresh = draftFromEnvironment(next.stored);
				setStatus(next);
				setDraft(fresh);
				setBaseline(fresh);
				setIssues(NO_ISSUES);
			})
			.catch(() => !cancelled && setStatus("failed"));
		return () => {
			cancelled = true;
		};
	}, [attempt]);

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
			baseline={baseline}
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
			onRetry={() => {
				setStatus("loading");
				setAttempt((value) => value + 1);
			}}
		/>
	);
}
