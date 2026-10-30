import { useT } from "@thinkrail/locales/react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function IssueList() {
	const t = useT();
	const issues = [
		{
			fileName: "midnight.json",
			label: t("settings.appearance.custom.error.invalidJson"),
			detail: "Unexpected token } in JSON at position 412",
		},
		{
			fileName: "solarized-dusk.json",
			label: t("settings.appearance.custom.error.invalidTheme"),
			detail: null,
		},
	];
	return (
		<div className="flex w-full flex-col gap-4">
			{issues.map((issue) => (
				<SettingsNotice
					key={issue.fileName}
					variant="warning"
					testId={`custom-theme-issue-${issue.fileName}`}
				>
					<span className="flex flex-col gap-4">
						<span className="tr-code-text">{issue.fileName}</span>
						<span>{issue.label}</span>
						{issue.detail ? (
							<span className="break-words text-text-muted">{issue.detail}</span>
						) : null}
					</span>
				</SettingsNotice>
			))}
		</div>
	);
}
