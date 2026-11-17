import { RiRefreshLine } from "@remixicon/react";
import { SUBAGENT_CATALOG_PROTOCOL_VERSION, type SubagentCatalogEntry } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useSyncExternalStore } from "react";
import {
	selectActiveRepoWorkspaceId,
	selectActiveSubagentProjectTrust,
	toast,
	useAppStore,
} from "@/store";
import { DelegationSettings } from "./DelegationSettings";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { subagentAvailability } from "./subagentAvailability";
import { type AgentCatalog, useSubagentCatalog } from "./useSubagentCatalog";

const SOURCE: Record<SubagentCatalogEntry["source"], MessageKey> = {
	builtin: "settings.agents.source.builtin",
	personal: "settings.agents.source.personal",
	project: "settings.agents.source.project",
};

export function AgentCatalogRows({
	catalog,
	disabledNames,
	disabled,
	onChange,
	onRefresh,
}: {
	catalog: AgentCatalog;
	disabledNames: readonly string[];
	disabled: boolean;
	onChange: (name: string, enabled: boolean) => void;
	onRefresh: () => void;
}) {
	const t = useT();
	if (catalog === "loading")
		return <LoadingRegion rows={6} label={t("settings.agents.loading")} testId="agents-loading" />;
	if (catalog === "failed")
		return (
			<SettingsNotice
				variant="error"
				testId="agents-load-failed"
				action={
					<Button variant="outline" size="s" disabled={disabled} onClick={onRefresh}>
						{t("settings.agents.retry")}
					</Button>
				}
			>
				{t("settings.agents.loadFailed")}
			</SettingsNotice>
		);
	if (catalog.length === 0)
		return (
			<p className="py-12 text-text-muted tr-text-ui" data-testid="agents-empty">
				{t("settings.agents.empty")}
			</p>
		);
	return catalog.map((entry) => (
		<SettingsRow
			key={entry.name}
			label={entry.name}
			testId={`agent-row-${entry.name}`}
			className="break-words"
			description={
				<>
					<span className="block text-text-subtle">{t(SOURCE[entry.source])}</span>
					<span className="block break-words">{entry.description}</span>
					<span className="mt-8 block break-all text-text-subtle">
						{entry.model ? (
							<>
								{t("settings.agents.pinned")} ·{" "}
								<code className="tr-code-text-small">{entry.model}</code>
							</>
						) : (
							t("settings.agents.parentModel")
						)}
						{entry.thinking !== undefined ? (
							<> · {t("settings.agents.effort", { effort: entry.thinking })}</>
						) : null}
					</span>
				</>
			}
			control={
				<SettingsSwitch
					checked={!disabledNames.includes(entry.name)}
					disabled={disabled}
					label={t("settings.agents.enableGlobally", { name: entry.name })}
					testId={`agent-toggle-${entry.name}`}
					onChange={(enabled) => onChange(entry.name, enabled)}
				/>
			}
		/>
	));
}

function AvailableAgents({
	workspaceId,
	trusted,
	welcomeGeneration,
}: {
	workspaceId: string | undefined;
	trusted: boolean;
	welcomeGeneration: number;
}) {
	const t = useT();
	const disabledNames = useAppStore((state) => state.disabledSubagents);
	const saving = useSyncExternalStore(
		subagentAvailability.subscribe,
		subagentAvailability.getSnapshot,
		subagentAvailability.getSnapshot,
	);
	const { catalog, refresh } = useSubagentCatalog(workspaceId, trusted, welcomeGeneration);
	const save = (name: string, enabled: boolean) => {
		void subagentAvailability.save(name, enabled).then((ok) => {
			if (ok === false) toast.error(t("settings.agents.saveFailed"));
		});
	};

	return (
		<SettingsGroup
			title={t("settings.agents.available")}
			description={t("settings.agents.description")}
			testId="settings-agent-catalog"
		>
			<div className="flex flex-wrap items-center justify-between gap-12 pb-12">
				<span className="text-text-default tr-text-label-pill">
					{t("settings.agents.globalScope")}
				</span>
				<Button
					variant="outline"
					size="s"
					iconLeft={RiRefreshLine}
					disabled={catalog === "loading" || saving.pending}
					onClick={refresh}
					data-testid="agents-refresh"
				>
					{t("settings.agents.refresh")}
				</Button>
			</div>
			<p className="pb-12 text-text-muted tr-text-metadata">{t("settings.agents.projectScope")}</p>
			{saving.pending ? (
				<p role="status" className="pb-12 text-text-muted tr-text-metadata">
					{t("settings.agents.saving")}
				</p>
			) : null}
			{saving.failed ? (
				<SettingsNotice
					variant="error"
					testId="agents-save-failed"
					action={
						<Button
							variant="outline"
							size="s"
							disabled={catalog === "loading"}
							onClick={() => {
								if (saving.failed) save(saving.failed.name, saving.failed.enabled);
							}}
						>
							{t("settings.agents.retry")}
						</Button>
					}
				>
					{t("settings.agents.saveFailed")}
				</SettingsNotice>
			) : null}
			<AgentCatalogRows
				catalog={catalog}
				disabledNames={disabledNames}
				disabled={saving.pending}
				onChange={save}
				onRefresh={refresh}
			/>
		</SettingsGroup>
	);
}

export function AgentsSettings() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const workspaceId = useAppStore(selectActiveRepoWorkspaceId);
	const trust = useAppStore(selectActiveSubagentProjectTrust);
	const welcomeGeneration = useAppStore((state) => state.welcomeGeneration);
	if (protocolVersion === null || protocolVersion < SUBAGENT_CATALOG_PROTOCOL_VERSION) return null;
	return (
		<SettingsPageContainer testId="settings-agents">
			<DelegationSettings />
			<AvailableAgents
				workspaceId={workspaceId}
				trusted={trust === "granted"}
				welcomeGeneration={welcomeGeneration}
			/>
		</SettingsPageContainer>
	);
}
