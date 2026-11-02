import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SegmentedControl } from "@/panels/SegmentedControl";
import { SettingsGroup, SettingsPageContainer } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

type Order = "oldest-first" | "newest-first";
type Growth = "compact" | "roomy" | "half-chat";

export default function Page() {
	const t = useT();
	const [order, setOrder] = useState<Order>("oldest-first");
	const [growth, setGrowth] = useState<Growth>("roomy");
	const [subagents, setSubagents] = useState(true);
	return (
		<div className="w-full max-w-[40rem]">
			<SettingsPageContainer testId="settings-chat">
				<SettingsGroup title={t("settings.chat.group")}>
					<SettingsRow
						label={t("settings.chat.messageOrder")}
						description={t("settings.chat.messageOrderDescription")}
						control={
							<SegmentedControl
								name="chat-message-order"
								label={t("settings.chat.messageOrder")}
								options={[
									{ id: "oldest-first", label: t("settings.chat.order.oldestFirst") },
									{ id: "newest-first", label: t("settings.chat.order.newestFirst") },
								]}
								value={order}
								onSelect={setOrder}
							/>
						}
					/>
					<SettingsRow
						label={t("settings.chat.composerSize")}
						description={t("settings.chat.composerSizeDescription")}
						control={
							<SegmentedControl
								name="composer-growth-limit"
								label={t("settings.chat.composerSize")}
								options={[
									{ id: "compact", label: t("settings.chat.growth.compact") },
									{ id: "roomy", label: t("settings.chat.growth.roomy") },
									{ id: "half-chat", label: t("settings.chat.growth.halfChat") },
								]}
								value={growth}
								onSelect={setGrowth}
							/>
						}
					/>
				</SettingsGroup>
				<SettingsGroup
					title={t("settings.subagents.title")}
					description={t("settings.subagents.description")}
				>
					<SettingsRow
						label={t("settings.subagents.allow")}
						description={
							subagents
								? t("settings.subagents.allowOnDescription")
								: t("settings.subagents.allowOffDescription")
						}
						control={
							<SettingsSwitch
								checked={subagents}
								label={t("settings.subagents.allowGlobally")}
								testId="subagents-global-toggle"
								onChange={setSubagents}
							/>
						}
					/>
				</SettingsGroup>
			</SettingsPageContainer>
		</div>
	);
}
