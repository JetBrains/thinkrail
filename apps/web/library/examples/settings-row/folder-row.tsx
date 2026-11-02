import { RiFileCopyLine, RiFolderOpenLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { SettingsGroup } from "@/panels/SettingsGroup";
import { SettingsRow } from "@/panels/SettingsRow";

export default function FolderRow() {
	const t = useT();
	const folder = "~/.thinkrail/locales";
	return (
		<div className="w-full max-w-[40rem]">
			<SettingsGroup title={t("settings.language.add.title")}>
				<SettingsRow
					label={t("settings.language.folder.label")}
					description={<code className="tr-code-text break-all">{folder}</code>}
					testId="language-folder"
					control={
						<div className="flex gap-8">
							<Button variant="outline" size="m" iconLeft={RiFileCopyLine} onClick={() => {}}>
								{t("settings.language.folder.copy")}
							</Button>
							<Button variant="outline" size="m" iconLeft={RiFolderOpenLine} onClick={() => {}}>
								{t("settings.language.folder.open")}
							</Button>
						</div>
					}
				/>
			</SettingsGroup>
		</div>
	);
}
