import { RiArrowGoBackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { SettingsGroup } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

type Override = "on" | "off" | null;

export default function OverrideTag() {
	const t = useT();
	const name = "feature/login";
	const globalEnabled = false;
	const [override, setOverride] = useState<Override>("on");
	const enabled = override === null ? globalEnabled : override === "on";
	return (
		<div className="w-full max-w-[32rem]">
			<SettingsGroup
				title={t("settings.subagents.workspaceHeading")}
				description={t("settings.subagents.workspaceDescription", { name })}
			>
				<SettingsRow
					label={t("settings.subagents.allow")}
					control={
						<span className="flex items-center gap-8">
							{override === null ? (
								<span className="tr-text-metadata text-text-subtle">
									{t("settings.subagents.source.global")}
								</span>
							) : (
								<Button
									variant="soft-primary"
									size="s"
									iconRight={RiArrowGoBackLine}
									aria-label={t("settings.subagents.resetEnabled", { name })}
									tooltip={t("settings.subagents.source.useGlobal")}
									onClick={() => setOverride(null)}
								>
									{t("settings.subagents.source.custom")}
								</Button>
							)}
							<SettingsSwitch
								checked={enabled}
								label={t("settings.subagents.allowInWorkspace", { name })}
								testId="subagents-workspace-toggle"
								onChange={(next) => setOverride(next ? "on" : "off")}
							/>
						</span>
					}
				/>
			</SettingsGroup>
		</div>
	);
}
