import type { SubagentOverride } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { selectActiveWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { SubagentSettings } from "./SubagentSettings";
import { saveSettings } from "./saveSettings";

export function DelegationSettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const enabled = useAppStore((state) => state.subagentsEnabled);
	const limit = useAppStore((state) => state.subagentMaxConcurrent);
	const workspace = useAppStore(selectActiveWorkspace);

	const setWorkspaceEnabled = (override: SubagentOverride | null) => {
		if (!workspace) return;
		getTransport()
			.request("workspace.setSubagentsOverride", { id: workspace.id, override })
			.catch((error: unknown) =>
				toast.error(errorText(error), t("settings.chat.workspaceSubagentsFailed")),
			);
	};
	const setWorkspaceLimit = (value: number | null) => {
		if (!workspace) return;
		getTransport()
			.request("workspace.setSubagentMaxConcurrent", { id: workspace.id, value })
			.catch((error: unknown) =>
				toast.error(errorText(error), t("settings.chat.workspaceSubagentLimitFailed")),
			);
	};

	return (
		<SubagentSettings
			protocolVersion={protocolVersion}
			globalEnabled={enabled}
			globalLimit={limit}
			workspace={workspace}
			onGlobalEnabledChange={(subagentsEnabled) =>
				void saveSettings({ subagentsEnabled }, t("settings.chat.globalSubagentsFailed"))
			}
			onWorkspaceEnabledChange={setWorkspaceEnabled}
			onGlobalLimitChange={(subagentMaxConcurrent) =>
				void saveSettings({ subagentMaxConcurrent }, t("settings.chat.subagentLimitFailed"))
			}
			onWorkspaceLimitChange={setWorkspaceLimit}
		/>
	);
}
