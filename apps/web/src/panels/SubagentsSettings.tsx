import type { SubagentOverride } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { AvailableAgents } from "./AvailableAgents";
import { SubagentSettings } from "./SubagentSettings";
import { saveSettings } from "./saveSettings";
import { useConfigReset } from "./settingDefaults";

export function SubagentsSettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const subagentsEnabled = useAppStore((state) => state.subagentsEnabled);
	const subagentMaxConcurrent = useAppStore((state) => state.subagentMaxConcurrent);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const enabledReset = useConfigReset("subagentsEnabled", "settings.chat.globalSubagentsFailed");
	const limitReset = useConfigReset("subagentMaxConcurrent", "settings.chat.subagentLimitFailed");

	const setWorkspaceSubagents = (override: SubagentOverride | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentsOverride", { id: activeWorkspace.id, override })
			.catch((err: unknown) =>
				toast.error(errorText(err), t("settings.chat.workspaceSubagentsFailed")),
			);
	};

	const setWorkspaceSubagentLimit = (value: number | null) => {
		if (!activeWorkspace) return;
		getTransport()
			.request("workspace.setSubagentMaxConcurrent", { id: activeWorkspace.id, value })
			.catch((err: unknown) =>
				toast.error(errorText(err), t("settings.chat.workspaceSubagentLimitFailed")),
			);
	};

	return (
		<SubagentSettings
			protocolVersion={protocolVersion}
			globalEnabled={subagentsEnabled}
			globalLimit={subagentMaxConcurrent}
			workspace={activeWorkspace}
			globalEnabledReset={enabledReset}
			globalLimitReset={limitReset}
			onGlobalEnabledChange={(enabled) =>
				void saveSettings({ subagentsEnabled: enabled }, t("settings.chat.globalSubagentsFailed"))
			}
			onWorkspaceEnabledChange={setWorkspaceSubagents}
			onGlobalLimitChange={(value) =>
				saveSettings({ subagentMaxConcurrent: value }, t("settings.chat.subagentLimitFailed"))
			}
			onWorkspaceLimitChange={setWorkspaceSubagentLimit}
			roster={<AvailableAgents />}
		/>
	);
}
