import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsGroup } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

export default function Group() {
	const t = useT();
	const [agentReview, setAgentReview] = useState(true);
	const [autoFix, setAutoFix] = useState(false);
	return (
		<div className="w-full max-w-[28rem]">
			<SettingsGroup title={t("settings.models.reviewGroup")}>
				<SettingsRow
					testId="agent-review-row"
					label={t("settings.models.agentReview")}
					description={t("settings.models.agentReviewDescription")}
					control={
						<SettingsSwitch
							checked={agentReview}
							label={t("settings.models.agentReview")}
							testId="agent-review-toggle"
							onChange={setAgentReview}
						/>
					}
				/>
				<SettingsRow
					testId="review-autofix-row"
					label={t("settings.models.autoFix")}
					description={t("settings.models.autoFixDescription")}
					control={
						<SettingsSwitch
							checked={autoFix}
							label={t("settings.models.autoFix")}
							testId="review-autofix-toggle"
							onChange={setAutoFix}
						/>
					}
				/>
			</SettingsGroup>
		</div>
	);
}
