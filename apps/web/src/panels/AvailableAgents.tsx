import { RiRefreshLine } from "@remixicon/react";
import { SUBAGENT_CATALOG_PROTOCOL_VERSION, type SubagentCatalogEntry } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { LEVEL_LABEL } from "@/chat/modelPicker";
import { SETTINGS_ROWS, SettingsGroup, SettingsNotice, SettingsRow } from "@/settingsKit";
import {
	selectActiveRepoWorkspaceId,
	selectActiveSubagentProjectTrust,
	toast,
	useAppStore,
} from "@/store";
import { errorText, getTransport } from "@/transport";
import { SETTING } from "./settingsCatalog";
import { type AgentCatalog, useSubagentCatalog } from "./useSubagentCatalog";

const SOURCE: Record<SubagentCatalogEntry["source"], MessageKey> = {
	builtin: "settings.agents.source.builtin",
	personal: "settings.agents.source.personal",
	project: "settings.agents.source.project",
};

export function AgentCatalogRows({
	catalog,
	disabledNames,
	onChange,
	onRefresh,
}: {
	catalog: AgentCatalog;
	disabledNames: readonly string[];
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
					<Button
						variant="outline"
						size="s"
						tabIndex={0}
						data-testid="agents-retry"
						onClick={onRefresh}
					>
						{t("common.retry")}
					</Button>
				}
			>
				{t("settings.agents.loadFailed")}
			</SettingsNotice>
		);
	if (catalog.length === 0)
		return (
			<p className="py-8 text-text-muted tr-text-metadata" data-testid="agents-empty">
				{t("settings.agents.empty")}
			</p>
		);
	return (
		<div data-setting-id={SETTING.subagentRoles.id} className={SETTINGS_ROWS}>
			{catalog.map((entry) => {
				const enabled = !disabledNames.includes(entry.name);
				return (
					<SettingsRow
						key={entry.name}
						rowId={`subagent-role-${entry.name}`}
						label={entry.name}
						testId={`agent-row-${entry.name}`}
						description={
							<>
								<span className="block text-text-subtle">{t(SOURCE[entry.source])}</span>
								<span className="block">{entry.description}</span>
								<span className="mt-4 block break-all text-text-subtle">
									{entry.model ? (
										<>
											{t("settings.agents.pinned")} ·{" "}
											<code className="tr-code-text-small">{entry.model}</code>
										</>
									) : (
										t("settings.agents.parentModel")
									)}
									{entry.thinking !== undefined ? (
										<>
											{" "}
											· {t("settings.agents.effort", { effort: t(LEVEL_LABEL[entry.thinking]) })}
										</>
									) : null}
								</span>
							</>
						}
						control={
							<Switch
								checked={enabled}
								label={t("settings.agents.enableGlobally", { name: entry.name })}
								testId={`agent-toggle-${entry.name}`}
								tabIndex={0}
								onCheckedChange={(next) => onChange(entry.name, next)}
							/>
						}
						reset={{ changed: !enabled, onReset: () => onChange(entry.name, true) }}
					/>
				);
			})}
		</div>
	);
}

export function AvailableAgents() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	if (protocolVersion === null || protocolVersion < SUBAGENT_CATALOG_PROTOCOL_VERSION) return null;
	return <AvailableAgentsGroup />;
}

function AvailableAgentsGroup() {
	const t = useT();
	const workspaceId = useAppStore(selectActiveRepoWorkspaceId);
	const trusted = useAppStore(selectActiveSubagentProjectTrust) === "granted";
	const welcomeGeneration = useAppStore((state) => state.welcomeGeneration);
	const disabledNames = useAppStore((state) => state.disabledSubagents);
	const { catalog, refresh } = useSubagentCatalog(workspaceId, trusted, welcomeGeneration);
	const save = (name: string, enabled: boolean) => {
		getTransport()
			.request("subagent.setEnabled", { name, enabled })
			.catch((err: unknown) => toast.error(errorText(err), t("settings.agents.saveFailed")));
	};

	return (
		<SettingsGroup
			title={t("settings.agents.available")}
			scope="allProjects"
			description={
				<>
					<span className="block">{t("settings.agents.description")}</span>
					<span className="block">{t("settings.agents.projectScope")}</span>
				</>
			}
			action={{
				rowId: "subagent-roles-refresh",
				control: (
					<Button
						variant="outline"
						size="s"
						tabIndex={0}
						iconLeft={RiRefreshLine}
						disabled={catalog === "loading"}
						onClick={refresh}
						data-testid="agents-refresh"
					>
						{t("settings.agents.refresh")}
					</Button>
				),
			}}
			testId="settings-agent-catalog"
		>
			<AgentCatalogRows
				catalog={catalog}
				disabledNames={disabledNames}
				onChange={save}
				onRefresh={refresh}
			/>
		</SettingsGroup>
	);
}
